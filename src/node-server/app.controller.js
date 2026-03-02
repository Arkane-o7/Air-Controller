// Feeder
const feeder = require('./app.feeder');

// FS and ssl
const fs = require('fs');
const path = require('path');

// Screenshot, ss.screenshot()
const ss = require('./screenshot');

// Express
const express = require('express');

const buttons = {
    BOTTOM_BUTTON : "A",
    RIGHT_BUTTON : "B",
    TOP_BUTTON : "Y",
    LEFT_BUTTON : "X",
    RIGHT_SHOULDER : "RIGHT_SHOULDER",
    LEFT_SHOULDER : "LEFT_SHOULDER",
    START : "START",
    BACK : "BACK"
}

const axes = {
    ANALOG_LEFT : "left",
    ANALOG_RIGHT: "right"
}

const shoulder = {
    LEFT_TRIGGER : "left",
    RIGHT_TRIGGER: "right"
}

class server {
    constructor()
    {
        this.start();
    }

    async start()
    {
        try {
            this.setVariables();
        } catch (error) {
            console.error(`[aircontroller] Failed to start server: ${error.message}`);
            return;
        }
        
        // Sleep for 0.1s to let the variables set up
        await new Promise(resolve => setTimeout(resolve, 100));

        this.createPaths();
        this.createSocket();
        this.runPort();
    }

    setVariables()
    {
        this._controllers = {};
        this._controllerSlots = {};
        this._controllerMeta = {};
        this._socketInputRate = {};
        this._maxControllers = parseInt(process.env.MAX_CONTROLLERS || "4", 10);
        this._maxMessagesPerSecond = parseInt(process.env.MAX_MSG_PER_SECOND || "180", 10);
        this._pairCode = process.env.PAIR_CODE ? String(process.env.PAIR_CODE).trim() : "";
        this._pairRequired = this._pairCode.length > 0;
        this._app = express();
        this.resolveTransport();
        this._https = this._protocol === 'https'
            ? require('https').createServer(this._credentials, this._app)
            : require('http').createServer(this._app);
        this._socket = require('socket.io')(this._https);
        this._port = process.env.PORT || 7200;
        this.getLocalIP();
    }

    resolveTransport()
    {
        const sslDir = path.join(__dirname, 'ssl');
        const keyPath = path.join(sslDir, 'key.pem');
        const certPath = path.join(sslDir, 'cert.pem');
        const allowHttpFallback = process.env.ALLOW_HTTP === '1';

        if(fs.existsSync(keyPath) && fs.existsSync(certPath))
        {
            this._protocol = 'https';
            this._credentials = {
                key: fs.readFileSync(keyPath, 'utf8'),
                cert: fs.readFileSync(certPath, 'utf8')
            };
            return;
        }

        if(allowHttpFallback)
        {
            this._protocol = 'http';
            this._credentials = null;
            console.warn('[aircontroller] SSL certificates not found, running in HTTP fallback mode.');
            return;
        }

        throw new Error('SSL certificates missing. Place key.pem and cert.pem in src/node-server/ssl or set ALLOW_HTTP=1 for development fallback.');
    }

    createPaths()
    {
        // Set root to xbox layout
        this._app.get('/', (req, res) => {
            return res.sendFile(__dirname + "/static/s-new.html");
        });
        
        // Set /static as root so the assets and stuffs can be loaded
        this._app.use('/', express.static(__dirname + '/static'));
    }

    createSocket()
    {
        this._socket.on('connection', (socket) => {
            this._controllerMeta[socket.id] = {
                socketId: socket.id,
                address: socket.handshake.address || 'unknown',
                userAgent: (socket.handshake.headers && socket.handshake.headers['user-agent']) || 'unknown',
                paired: !this._pairRequired,
                connectedAt: Date.now(),
                lastInputAt: null,
                slot: null,
                status: 'connected'
            };

            this.emitHostTelemetry();

            let isPaired = !this._pairRequired;

            if(this._pairRequired)
            {
                socket.emit('controller_status', {
                    state: 'pair_required',
                    message: 'Pairing code required before connecting controller.'
                });
            }

            socket.on('pair', (payload = {}) => {
                if(isPaired) return;

                const providedCode = String(payload.code || '').trim();

                if(providedCode !== this._pairCode)
                {
                    socket.emit('controller_status', {
                        state: 'pair_invalid',
                        message: 'Invalid pairing code.'
                    });
                    return;
                }

                isPaired = true;
                if(this._controllerMeta[socket.id])
                {
                    this._controllerMeta[socket.id].paired = true;
                    this._controllerMeta[socket.id].status = 'paired';
                }

                socket.emit('controller_status', {
                    state: 'pair_ok',
                    message: 'Pairing successful.'
                });

                this.attachControllerToSocket(socket);
            });

            if(isPaired)
            {
                this.attachControllerToSocket(socket);
            }
        });
    }

    attachControllerToSocket(socket)
    {
        if(this._controllers[socket.id])
        {
            return;
        }

            const slot = this.allocateSlot(socket.id);

            if(slot === null)
            {
                socket.emit('controller_status', {
                    state: 'full',
                    maxControllers: this._maxControllers,
                    message: `Controller limit reached (${this._maxControllers}).`
                });
                socket.disconnect(true);
                return;
            }

            // Notification Callback
            let notificationCallback = function(data)
            {
                // Do something when receive callback
            }

            
            this._controllers[socket.id] = new feeder("x360", notificationCallback);
            let client = this._controllers[socket.id];

            if(this._controllers[socket.id] !== false)
            {
                if(this._controllerMeta[socket.id])
                {
                    this._controllerMeta[socket.id].slot = slot;
                    this._controllerMeta[socket.id].status = 'active';
                }

                this.emitHostTelemetry();

                socket.emit('controller_status', {
                    state: 'assigned',
                    slot: slot,
                    activeControllers: this.activeControllerCount(),
                    maxControllers: this._maxControllers,
                    message: `Connected as Player ${slot}.`
                });

                socket.on('disconnect', () => {
                    console.log('user disconnected');
                    if(client)
                    {
                        client.disconnectController();
                    }

                    this.releaseSlot(socket.id);
                });

                socket.on('latency', function(msg, callback){
                    callback();
                });

                socket.on('message', (data) => {
                    if(!this.allowInputForSocket(socket.id))
                    {
                        return;
                    }

                    const payload = this.normalizePayload(data);
                    if(!payload)
                    {
                        return;
                    }

                    if(this._controllerMeta[socket.id])
                    {
                        this._controllerMeta[socket.id].lastInputAt = Date.now();
                    }

                    switch(payload.inputType)
                    {
                        case "axis":
                            // Use this if circular joystick : var coord = client.convertCircleCoordToSquareCoord(payload.x, payload.y, payload.r)
                            client.setAxisValue(`${axes[payload.axis]}X`, payload.x, payload.r);
                            client.setAxisValue(`${axes[payload.axis]}Y`, payload.y, payload.r);
                            break;
                        case "triggerAxis":
                            client.setAxisValue(`${shoulder[payload.axis]}Trigger`, payload.value, payload.max);
                            break;
                        case "button":
                            client.setButtonValue(buttons[payload.button], !!payload.v);
                            break;
                        case "dpad":
                            client.setAxisValue("dpadHorz", payload.v.x, payload.max);
                            client.setAxisValue("dpadVert", payload.v.y, payload.max);
                            break;
                    }
                });
            } else {
                this.releaseSlot(socket.id);
                socket.emit('controller_status', {
                    state: 'error',
                    message: 'Failed to initialize virtual controller.'
                });
                socket.disconnect(true);
            }
    }

    allocateSlot(socketId)
    {
        if(this.activeControllerCount() >= this._maxControllers)
        {
            return null;
        }

        for(let i = 1; i <= this._maxControllers; i++)
        {
            if(!Object.values(this._controllerSlots).includes(i))
            {
                this._controllerSlots[socketId] = i;
                return i;
            }
        }

        return null;
    }

    releaseSlot(socketId)
    {
        delete this._controllers[socketId];
        delete this._controllerSlots[socketId];
        delete this._socketInputRate[socketId];
        delete this._controllerMeta[socketId];
        this.emitHostTelemetry();
    }

    activeControllerCount()
    {
        return Object.keys(this._controllerSlots).length;
    }

    allowInputForSocket(socketId)
    {
        const now = Date.now();
        if(!this._socketInputRate[socketId])
        {
            this._socketInputRate[socketId] = {
                start: now,
                count: 0
            };
        }

        const bucket = this._socketInputRate[socketId];
        if((now - bucket.start) >= 1000)
        {
            bucket.start = now;
            bucket.count = 0;
        }

        bucket.count += 1;
        return bucket.count <= this._maxMessagesPerSecond;
    }

    finiteNumber(value)
    {
        return Number.isFinite(value);
    }

    clamp(value, min, max)
    {
        return Math.min(max, Math.max(min, value));
    }

    normalizePayload(data)
    {
        if(!data || typeof data !== 'object')
        {
            return null;
        }

        switch(data.inputType)
        {
            case "axis": {
                if(!(data.axis in axes)) return null;
                const r = Number(data.r);
                const x = Number(data.x);
                const y = Number(data.y);
                if(!this.finiteNumber(r) || r <= 0) return null;
                if(!this.finiteNumber(x) || !this.finiteNumber(y)) return null;

                return {
                    inputType: "axis",
                    axis: data.axis,
                    r: r,
                    x: this.clamp(x, -r, r),
                    y: this.clamp(y, -r, r)
                };
            }
            case "triggerAxis": {
                if(!(data.axis in shoulder)) return null;
                const max = Number(data.max);
                const value = Number(data.value);
                if(!this.finiteNumber(max) || max <= 0) return null;
                if(!this.finiteNumber(value)) return null;

                return {
                    inputType: "triggerAxis",
                    axis: data.axis,
                    max: max,
                    value: this.clamp(value, 0, max)
                };
            }
            case "button": {
                if(!(data.button in buttons)) return null;
                return {
                    inputType: "button",
                    button: data.button,
                    v: !!data.v
                };
            }
            case "dpad": {
                if(!data.v || typeof data.v !== 'object') return null;
                const x = Number(data.v.x);
                const y = Number(data.v.y);
                const max = Number(data.max);
                if(!this.finiteNumber(x) || !this.finiteNumber(y)) return null;
                if(!this.finiteNumber(max) || max <= 0) return null;

                return {
                    inputType: "dpad",
                    max: max,
                    v: {
                        x: this.clamp(x, -max, max),
                        y: this.clamp(y, -max, max)
                    }
                };
            }
            default:
                return null;
        }
    }

    getTelemetrySnapshot()
    {
        const controllers = Object.keys(this._controllerMeta).map(socketId => {
            const meta = this._controllerMeta[socketId];
            return {
                socketId: meta.socketId,
                slot: this._controllerSlots[socketId] || meta.slot || null,
                address: meta.address,
                userAgent: meta.userAgent,
                paired: !!meta.paired,
                status: meta.status || 'connected',
                connectedAt: meta.connectedAt || null,
                lastInputAt: meta.lastInputAt || null
            };
        }).sort((a, b) => {
            if(a.slot === null && b.slot === null) return 0;
            if(a.slot === null) return 1;
            if(b.slot === null) return -1;
            return a.slot - b.slot;
        });

        return {
            type: 'telemetry',
            activeControllers: this.activeControllerCount(),
            controllers
        };
    }

    emitHostTelemetry()
    {
        if(typeof process.send === 'function')
        {
            process.send(this.getTelemetrySnapshot());
        }
    }

    getLocalIP()
    {
        var t = this;
        require('dns').lookup(require('os').hostname(), function (err, add, fam) {
            t._local = add;
        });
    }

    runPort()
    {
        this._https.listen(this._port, () => {
            console.log(`Open this link on your phone :`);
            console.log(`${this._protocol}://${this._local}:${this._port}`);
            console.log(`Max controllers: ${this._maxControllers}`);
        });
    }
}

let srv = new server();