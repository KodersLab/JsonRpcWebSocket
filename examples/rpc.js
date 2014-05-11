var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
///<reference path="node.d.ts" />

//TODO: Allow module to be used in browser in a better way... this is not so sexy...
if (typeof window != "undefined")
    exports = window;

// Create Module
(function (RPC) {
    // On nodejs use bluebird as promise handler
    if (typeof window === "undefined") {
        var Promise = require("bluebird");
    } else {
        // On browser try the available one or search for an implementation (maybe bluebird on the browser?)
        Promise = window['Promise'] || Promise;
    }

    /**
    * Since RPC is bidirectional and server and clients works in the same way,
    * create a base class that is extended for the actual scenario.
    **/
    var Base = (function () {
        function Base(namespace) {
            if (typeof namespace === "undefined") { namespace = 'rpc'; }
            // id counter to generate a uuid
            this.id = 0;
            // namespace for socket.io event.
            this.namespace = 'rpc';
            // stores exposed methods available to be called.
            this.exposed = {};
            // stores promises in a deferred fashion so they can be resolved and rejected externally
            this.deferred = {};
            // set namespace by constructor
            this.namespace = namespace;
        }
        /**
        * stores a function in the exposed array, so it can be called via RPC.
        * @param name {String} The method name to be stored.
        * @param fn {Function} The actual function to be stored.
        **/
        Base.prototype.expose = function (name, fn) {
            // expose function
            this.exposed[name] = fn;
        };

        /**
        * A helper wich prepends rpc: and appends : followed by the given direction.
        * @param direction {String} The direction, default client2server
        **/
        Base.prototype.channel = function (direction) {
            if (typeof direction === "undefined") { direction = 'client2server'; }
            return 'rpc:' + this.namespace + ':' + direction;
        };

        /**
        * This is the base logic for the rpc response handling,
        * rpc response is when you receive an object with id, error, result.
        * @param data {Object} The object with id, error, result.
        **/
        Base.prototype.handleResponse = function (data) {
            // Stores props in vars giving a default if not setted.
            var id = data.id || null;
            var result = data.result || null;
            var errors = data.error || null;

            // If no id is given, fail.
            // TODO: maybe handle no id?
            if (id == null)
                return;

            // If no deferred object has been registered for this call, exit.
            if (!this.deferred.hasOwnProperty(id))
                return;

            // If result prop is null and errors is not, reject promise.
            if (result == null && errors != null) {
                this.deferred[id].reject(errors);
            }

            // if error prop is null and result is not, resolve promise.
            if (result != null && errors == null) {
                this.deferred[id].resolve(result);
            }

            // Remove deferred from archive, no more use for it.
            delete this.deferred[id];
        };

        /**
        * This is the base logic for the rpc request handling,
        * rpc request is when you receive an object with id, method, params.
        * @param socket {Socket} The socket to emit to.
        * @param direction {String} The direction: client2server or server2client.
        * @param data {Object} The object with id, method, params.
        **/
        Base.prototype.handleRequest = function (socket, direction, data) {
            // Stores props in vars giving a default if not setted.
            var id = data.id || null;
            var method = data.method || null;
            var params = data.params || [];

            // If no id is given, reject.
            // TODO: is possible to handle this?
            if (id === null)
                return;
            var channel = this.channel(direction);
            var handled = false;

            // Create reject function
            function reject(errors) {
                if (handled)
                    return;
                handled = true;
                return socket.emit(channel, {
                    id: id,
                    result: null,
                    error: errors
                });
            }

            // Create resolve function
            function resolve(value) {
                if (handled)
                    return;
                handled = true;
                return socket.emit(channel, {
                    id: id,
                    result: value,
                    error: null
                });
            }

            // Requested method is exposed?
            if (!this.exposed.hasOwnProperty(method) || typeof this.exposed[method] === "undefined") {
                reject("No method " + method + " exposed on server.");
            }

            // Prepend the rpc object with resolve, reject, rpc, socket to the object.
            var args = [{ resolve: resolve, reject: reject, socket: socket, rpc: this }].concat(params);

            try  {
                // Resolve method should be called by the exposed method.
                var v = this.exposed[method].apply(socket, args);
            } catch (e) {
                // An error has occurred, reject.
                reject(e);
            }
        };

        /**
        * Handle invoke, invoke is when you call a remote function.
        * @param socket {Socket} The socket to emit to.
        * @param direction {String} The direction: client2server or server2client.
        * @param method {String} The exposed method.
        * @param args {Array} The array containing the args for the method.
        **/
        Base.prototype.handleInvoke = function (socket, direction, method, args) {
            // Increment id.
            this.id++;

            // Store id to avoid its changes during the execution.
            var id = this.id;

            // Create promise as deferred, more sexy.
            var deferred = { promise: null, resolve: null, reject: null, socket: null };
            deferred.socket = socket;
            deferred.promise = new Promise(function (resolve, reject) {
                deferred.resolve = resolve;
                deferred.reject = reject;
            });

            // Store deferred by id.
            this.deferred[id] = deferred;

            // Emit via socket the function call.
            socket.emit(this.channel(direction), {
                id: id,
                method: method,
                params: args
            });

            // Return the promise.
            return deferred.promise;
        };
        return Base;
    })();
    RPC.Base = Base;

    var Client = (function (_super) {
        __extends(Client, _super);
        function Client(socket, namespace) {
            _super.call(this, namespace);
            this.socket = null;
            this.socket = typeof socket === "string" ? io.connect(socket) : socket;
            var that = this;
            this.socket.on(this.channel('server2client'), function (data) {
                that.server2client(data);
            });
            this.socket.on(this.channel('client2server'), function (data) {
                that.client2server(data);
            });
        }
        Client.prototype.client2server = function (data) {
            return this.handleResponse(data);
        };

        Client.prototype.server2client = function (data) {
            return this.handleRequest(this.socket, 'server2client', data);
        };

        Client.prototype.invoke = function (method) {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 1); _i++) {
                args[_i] = arguments[_i + 1];
            }
            return this.handleInvoke(this.socket, 'client2server', method, args);
        };
        return Client;
    })(Base);
    RPC.Client = Client;

    var Server = (function (_super) {
        __extends(Server, _super);
        function Server(io, namespace) {
            _super.call(this, namespace);
            var that = this;
            io.sockets.on('connection', function (socket) {
                socket.on(that.channel('server2client'), function (data) {
                    that.server2client(socket, data);
                });
                socket.on(that.channel('client2server'), function (data) {
                    that.client2server(socket, data);
                });
            });
        }
        Server.prototype.server2client = function (socket, data) {
            return this.handleResponse(data);
        };

        Server.prototype.client2server = function (socket, data) {
            return this.handleRequest(socket, 'client2server', data);
        };

        Server.prototype.invoke = function (socket, method) {
            var args = [];
            for (var _i = 0; _i < (arguments.length - 2); _i++) {
                args[_i] = arguments[_i + 2];
            }
            return this.handleInvoke(socket, 'server2client', method, args);
        };
        return Server;
    })(Base);
    RPC.Server = Server;
})(exports.RPC || (exports.RPC = {}));
var RPC = exports.RPC;
