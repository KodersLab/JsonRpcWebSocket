// require library
var RPC = require('jsonrpcwebsocket').RPC;
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
var srpc = new RPC.Server(io);

// Expose serverResolvedMethod.
srpc.expose('serverResolvedMethod', function(rpc, a, b){
	rpc.resolve('A was '+a+', B was '+b);
});	

// Expose serverRejectedMethod.
srpc.expose('serverRejectedMethod', function(rpc, a, b){
	rpc.reject('Rejected by server.');
});

server.listen(80);