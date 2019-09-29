/**
 * Copyright Benjamin Girault 2019
 * Copyright reelyActive 2019
 * We believe in an open Internet of Things
 */


const net = require('net');
const Raddec = require('raddec');


const DEFAULT_SOURCES = [];
const DEFAULT_TARGETS = [];
const DEFAULT_RADDEC_PORT = 50001;
const DEFAULT_ENABLE_FORWARDING = true;
const DEFAULT_RADDEC_ENCODING_OPTIONS = {
    includeTimestamp: true,
    includePackets: true
};
const DEFAULT_SERVER_LISTENING_CALLBACK = (address, port) => {console.log('TCP Server started on ' + address + ':' + port);};
const DEFAULT_SERVER_RADDEC_ERROR_CALLBACK = (error) => {};
const DEFAULT_CLIENT_READY_CALLBACK = (address, port) => {console.log('TCP Client socket to ' + address + ':' + port + ' started');}
const DEFAULT_TCP_FORWARD_CALLBACK = (err, raddec, target_address, target_port) => {};


/**
 * RaddecRelayUdp Class
 * Interface for relaying raddecs to/from remote servers.
 */
class RaddecRelayTcp {

  /**
   * RaddecRelayTcp constructor
   * @param {Object} options The options as a JSON object.
   * @constructor
   */
  constructor(options) {
    options = options || {};

    this.handleRaddec = options.raddecHandler;
    this.enableHandling = (typeof this.handleRaddec === 'function');
    this.enableForwarding = options.enableForwarding !== undefined ? options.enableForwarding : DEFAULT_ENABLE_FORWARDING;

    this.raddecEncodingOptions = options.raddecEncodingOptions ||
                                 DEFAULT_RADDEC_ENCODING_OPTIONS;

    let sources = options.sources || DEFAULT_SOURCES;
    let targets = options.targets || DEFAULT_TARGETS;

    let tcpServerListeningCallback = (typeof options.tcpServerListeningCallback === 'function') ? options.tcpServerListeningCallback : DEFAULT_SERVER_LISTENING_CALLBACK;
    let tcpServerRaddecErrorCallback = (typeof options.tcpServerRaddecErrorCallback === 'function') ? options.tcpServerRaddecErrorCallback : DEFAULT_SERVER_RADDEC_ERROR_CALLBACK;

    this.sources = [];
    sources.forEach((source) => {
      source.port = source.port || DEFAULT_RADDEC_PORT;
      if(source.hasOwnProperty('address')) {
        this.sources.push(createRaddecListener(this, source.address,
                                               source.port, tcpServerListeningCallback, tcpServerRaddecErrorCallback));
      }
    });

    let tcpClientReadyCallback = (typeof options.tcpClientReadyCallback === 'function') ? options.tcpClientReadyCallback : DEFAULT_CLIENT_READY_CALLBACK;
    this.tcpForwardErrorCallback = (typeof options.tcpForwardErrorCallback === 'function') ? options.tcpForwardErrorCallback : DEFAULT_CLIENT_RADDEC_ERROR_CALLBACK;

    this.targets = [];
    targets.forEach((target) => {
      target.port = target.port || DEFAULT_RADDEC_PORT;
      if(target.hasOwnProperty('address')) {
        this.targets.push(createRaddecSender(this, target.address, target.port, tcpClientReadyCallback));
      }
    });
  }

  /**
   * Relay the given raddec.
   * @param {Raddec} raddec The given Raddec instance.
   * @param {Array} targetIndices The optional indices of targets to relay to.
   */
  relayRaddec(raddec, targetIndices) {
    let raddecHex = raddec.encodeAsHexString(this.raddecEncodingOptions);
    let raddecBuffer = Buffer.from(raddecHex, 'hex');

    if (Array.isArray(targetIndices)) {
      targetIndices.filter((t) => {return targetIndices === null || t < this.targets.length;}).forEach((targetIndex) => {
        this.targets[targetIndex].write(raddecBuffer, (err) => {
            this.tcpForwardErrorCallback(err, raddecBuffer, this.targets[targetIndex].remoteAddress, this.targets[targetIndex].remotePort);
          }
        );
      });
    } else {
      this.targets.forEach((target) => {
     const net = require('net');
   target.write(raddecBuffer, (err) => {
            this.tcpForwardErrorCallback(err, raddecBuffer, target.remoteAddress, target.remotePort);
          }
        );
      });
    }
  }

  /**
   * Handle the given source raddec depending on the relay configuration.
   * @param {Raddec} raddec The given Raddec instance.
   */
  handleSourceRaddec(raddec) {
    if(this.enableForwarding) {
      this.relayRaddec(raddec);
    }
    if(this.enableHandling) {
      this.handleRaddec(raddec);
    }
  }

}


/**
 * Create a TCP server to listen for raddecs from the given source and to
 * handle with the given function.
 * @param {RaddecRelayTcp} instance The relay instance.
 * @param {String} address The given address to listen on.
 * @param {Number} port The given port to listen on.
 * @param {function} raddec_error_callback Callback function when a message triggers an errror when Raddec decodes it.
 * @param {function} listen_callback Callback function when a the TCP server starts listening.
 */
function createRaddecListener(instance, address, port, raddec_error_callback, listen_callback) {
  let server = net.createServer((socket) => {
    socket.on('data', (msg) => {
      try {
        let raddec = new Raddec(msg);
  
        if(raddec !== null) {
          instance.handleSourceRaddec(raddec);
        }
      } catch(error) {
        raddec_error_callback(error);
      };
    });
  });

  server.listen(port, address, () => {listen_callback(address, port);});

  return server;
}



/**
 * Create a TCP socket to send raddecs to the given target and to handle with the given function.
 * @param {RaddecRelayTcp} instance The relay instance.
 * @param {String} address The given address to connect the socket to.
 * @param {Number} port The given port to connect the socket to.
 * @param {function} raddec_error_callback Callback function when a message triggers an errror when Raddec decodes it.
 * @param {function} listen_callback Callback function when a the TCP socket is ready.
 */
function createRaddecSender(instance, address, port, listen_callback) {
  let client = new net.Socket();

  client.connect(port, address, () => {listen_callback(address, port);});

  return client;
}


module.exports = RaddecRelayTcp;
