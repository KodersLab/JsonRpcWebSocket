// require library
// use instead var RPC = require('jsonrpcwebsocket').RPC;
var RPC = require(__dirname+'/../index.js').RPC;
// Import express, socket.io and other dependencies
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io').listen(server);


// Server index, bluebird and rpc.js for the client.
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.get('/bluebird.js', function (req, res) {
  res.sendfile(__dirname + '/bluebird.js');
});

app.get('/rpc.js', function (req, res) {
	// Serve rpc.js (actually a copy of index.js)
  res.sendfile(__dirname + '/rpc.js');
});

// Create rpc server instance
var srpc = new RPC.Server(io.sockets);

// Expose serverResolvedMethod.
srpc.methods.serverResolvedMethod =  function(rpc, a, b){
	rpc.resolve('A was '+a+', B was '+b);
};	

// Expose serverRejectedMethod.
srpc.methods.serverRejectedMethod = function(rpc, a, b){
	rpc.reject('Rejected by server.');
};

// After a client is connected, call its methods.
io.sockets.on('connection', function(socket){
	srpc.invoke(socket, 'clientResolvedMethod',1,2).then(function(v){
		console.log('Resolved: '+v);
	},function(v){
		console.log('Rejected: '+v);
	});
	srpc.invoke(socket, 'clientRejectedMethod',1,2).then(function(v){
		console.log('Resolved: '+v);
	},function(v){
		console.log('Rejected: '+v);
	});
	srpc.invoke(socket, 'clientMissingMethod',1,2).then(function(v){
		console.log('Resolved: '+v);
	},function(v){
		console.log('Rejected: '+v);
	});
});

server.listen(80);