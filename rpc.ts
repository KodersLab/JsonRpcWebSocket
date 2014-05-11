///<reference path="node.d.ts" />
declare class Promise {
    constructor(resolver: Function);
}

declare module io {
    export function connect(url: string);
}

//TODO: Allow module to be used in browser in a better way... this is not so sexy...
if (typeof window != "undefined") exports = window;

// Create Module
export module RPC {
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
    export class Base {
        // id counter to generate a uuid
        private id: number = 0;
        // namespace for socket.io event.
        private namespace: string = 'rpc';
        // stores exposed methods available to be called.
        private exposed: { [name: string]: Function } = {};
        // stores promises in a deferred fashion so they can be resolved and rejected externally
        private deferred: {
            [name: number]: {
                reject: Function;
                resolve: Function;
                promise: Function;
            }
        } = {};

        constructor(namespace = 'rpc') {
            // set namespace by constructor
            this.namespace = namespace;
        }

        /**
        * stores a function in the exposed array, so it can be called via RPC.
        * @param name {String} The method name to be stored.
        * @param fn {Function} The actual function to be stored.
        **/
        expose(name: string, fn: Function) {
            // expose function
            this.exposed[name] = fn;
        }

        /**
        * A helper wich prepends rpc: and appends : followed by the given direction.
        * @param direction {String} The direction, default client2server
        **/
        channel(direction: string = 'client2server') {
            return 'rpc:' + this.namespace + ':' + direction;
        }

        /**
        * This is the base logic for the rpc response handling,
        * rpc response is when you receive an object with id, error, result.
        * @param data {Object} The object with id, error, result.
        **/
        handleResponse(data) {
            // Stores props in vars giving a default if not setted.
            var id = data.id || null;
            var result = data.result || null;
            var errors = data.error || null;
            // If no id is given, fail.
            // TODO: maybe handle no id?
            if (id == null) return;
            // If no deferred object has been registered for this call, exit.
            if (!this.deferred.hasOwnProperty(id)) return;
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
        }

        /**
        * This is the base logic for the rpc request handling,
        * rpc request is when you receive an object with id, method, params.
        * @param socket {Socket} The socket to emit to.
        * @param direction {String} The direction: client2server or server2client.
        * @param data {Object} The object with id, method, params.
        **/
        handleRequest(socket, direction, data) {
            // Stores props in vars giving a default if not setted.
            var id = data.id || null;
            var method = data.method || null;
            var params = data.params || [];
            // If no id is given, reject.
            // TODO: is possible to handle this?
            if (id === null) return;
            // Requested method is exposed?
            if (!this.exposed.hasOwnProperty(method)) {
                reject("No method " + method + " exposed on server.");
            }
            var that = this;
            var handled = false;
            // Create reject function
            function reject(errors) {
                if (handled) return;
                handled = true;
                return socket.emit(that.channel(direction), {
                    id: id,
                    result: null,
                    error: errors
                });
            }
            // Create resolve function
            function resolve(value) {
                if (handled) return;
                handled = true;
                return socket.emit(that.channel(direction), {
                    id: id,
                    result: value,
                    error: null
                });
            }
            // Prepend the rpc object with resolve, reject, rpc, socket to the object.
            var args = [{ resolve: resolve, reject: reject, socket: socket, rpc: that }].concat(params);
            // Try resolving, if fails
            try {
                // Resolve method should be called by the exposed method.
                var v = this.exposed[method].apply(socket, args);
            } catch (e) {
                // An error has occurred, reject.
                reject(e);
            }
        }

        /**
        * Handle invoke, invoke is when you call a remote function.
        * @param socket {Socket} The socket to emit to.
        * @param direction {String} The direction: client2server or server2client.
        * @param method {String} The exposed method.
        * @param args {Array} The array containing the args for the method.
        **/
        handleInvoke(socket, direction, method, args) {
            // Increment id.
            this.id++;
            // Store id to avoid its changes during the execution.
            var id: number = this.id;
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
        }
    }

    export class Client extends Base {
        private socket = null;

        constructor(socket, namespace) {
            super(namespace);
            this.socket = typeof socket === "string" ? io.connect(socket) : socket;
            var that = this;
            this.socket.on(this.channel('server2client'), function (data) {
                that.server2client(data);
            });
            this.socket.on(this.channel('client2server'), function (data) {
                that.client2server(data);
            });
        }

        private client2server(data) {
            return this.handleResponse(data);
        }

        private server2client(data) {
            return this.handleRequest(this.socket, 'server2client', data);
        }

        invoke(method, ...args) {
            return this.handleInvoke(this.socket, 'client2server', method, args);
        }
    }

    export class Server extends Base {
        constructor(io, namespace) {
            super(namespace);
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

        private server2client(socket, data) {
            return this.handleResponse(data);
        }

        private client2server(socket, data) {
            return this.handleRequest(socket, 'client2server', data);
        }

        invoke(socket, method, ...args) {
            return this.handleInvoke(socket, 'server2client', method, args);
        }
    }
}