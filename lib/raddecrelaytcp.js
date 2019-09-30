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
const DEFAULT_SERVER_LISTENING_CALLBACK = (address, port) => {console.log('TCP Server: started on ' + address + ':' + port);};
const DEFAULT_SERVER_CLIENT_CONNECTED_CALLBACK = (address, port) => {console.log('TCP Server: Client connected: ' + address + ':' + port);};
const DEFAULT_SERVER_CLIENT_CLOSED_CALLBACK = (had_error, address, port) => {console.log('TCP Server: Client disconnected: ' + address + ':' + port);};
const DEFAULT_SERVER_SOCKER_ERROR_CALLBACK = (error, address, port) => {console.log('TCP Server: Client ' + address + ':' + port + ' error (' + error.message + ')');};
const DEFAULT_SERVER_RADDEC_ERROR_CALLBACK = (error) => {};

const DEFAULT_CLIENT_READY_CALLBACK = (address, port) => {console.log('TCP Client: Socket to ' + address + ':' + port + ' started');}
const DEFAULT_TCP_FORWARD_CALLBACK = (err, raddec, target_address, target_port) => {};
const DEFAULT_TCP_DROPPED_RADDEC_CALLBACK = () => {};
const DEFAULT_TCP_SOCKET_ERROR_CALLBACK = (error, address, port) => {console.log('TCP Client: Socket error to ' + address + ':' + port + ' (' + error.message + ')');};
const DEFAULT_CLIENT_CLOSED_CALLBACK = (had_error, address, port) => {console.log('TCP Client: Socket to ' + address + ':' + port + ' ended');};
const DEFAULT_CLIENT_RETRY_TIMEOUT_MS = 1000;

const DEFAULT_TCP_MSG_LENGTH_OPENING = 'RAD';
const DEFAULT_TCP_MSG_LENGTH_OPENING_BUFFER = Buffer.from(DEFAULT_TCP_MSG_LENGTH_OPENING);
const DEFAULT_TCP_MSG_LENGTH_OPENING_HEX = DEFAULT_TCP_MSG_LENGTH_OPENING_BUFFER.toString('hex');

const DEFAULT_TCP_MSG_LENGTH_CLOSING = 'DEC';
const DEFAULT_TCP_MSG_LENGTH_CLOSING_BUFFER = Buffer.from(DEFAULT_TCP_MSG_LENGTH_CLOSING);
const DEFAULT_TCP_MSG_LENGTH_CLOSING_HEX = DEFAULT_TCP_MSG_LENGTH_CLOSING_BUFFER.toString('hex');


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

    this.tcpServerListeningCallback = (typeof options.tcpServerListeningCallback === 'function') ? options.tcpServerListeningCallback : DEFAULT_SERVER_LISTENING_CALLBACK;
    this.tcpServerClientConnectedCallback = (typeof options.tcpServerClientConnectedCallback === 'function') ? options.tcpServerClientConnectedCallback : DEFAULT_SERVER_CLIENT_CONNECTED_CALLBACK;
    this.tcpServerConnectionClosedCallback = (typeof options.tcpServerConnectionClosedCallback === 'function') ? options.tcpServerConnectionClosedCallback : DEFAULT_SERVER_CLIENT_CLOSED_CALLBACK;
    this.tcpServerSocketErrorCallback = (typeof options.tcpServerSocketErrorCallback === 'function') ? options.tcpServerSocketErrorCallback : DEFAULT_SERVER_SOCKER_ERROR_CALLBACK;
    this.tcpServerRaddecErrorCallback = (typeof options.tcpServerRaddecErrorCallback === 'function') ? options.tcpServerRaddecErrorCallback : DEFAULT_SERVER_RADDEC_ERROR_CALLBACK;

    this.sources = [];
    sources.forEach((source) => {
      source.port = source.port || DEFAULT_RADDEC_PORT;
      if(source.hasOwnProperty('address')) {
        createRaddecListener(this, this.sources.length, source.address, source.port);
      }
    });

    this.tcpClientReadyCallback = (typeof options.tcpClientReadyCallback === 'function') ? options.tcpClientReadyCallback : DEFAULT_CLIENT_READY_CALLBACK;
    this.tcpForwardCallback = (typeof options.tcpForwardCallback === 'function') ? options.tcpForwardCallback : DEFAULT_TCP_FORWARD_CALLBACK;
    this.tcpDroppedRaddec = (typeof options.tcpDroppedRaddec === 'function') ? options.tcpDroppedRaddec : DEFAULT_TCP_DROPPED_RADDEC_CALLBACK;
    this.tcpClientSocketError = (typeof options.tcpClientSocketError === 'function') ? options.tcpClientSocketError : DEFAULT_TCP_SOCKET_ERROR_CALLBACK;
    this.tcpClientConnectionClosed = (typeof options.tcpClientConnectionClosed === 'function') ? options.tcpClientConnectionClosed : DEFAULT_CLIENT_CLOSED_CALLBACK;
    this.retryTargetTimeout = options.retryTargetTimeout || DEFAULT_CLIENT_RETRY_TIMEOUT_MS;

    this.targets = [];
    targets.forEach((target) => {
      target.port = target.port || DEFAULT_RADDEC_PORT;
      if(target.hasOwnProperty('address')) {
        createRaddecSender(this, this.targets.length, target.address, target.port);
      }
    });
  }

  /**
   * Relay the given raddec.
   * @param {Raddec} raddec The given Raddec instance.
   * @param {Array} targetIndices The optional indices of targets to relay to.
   */
  relayRaddec(raddec, targetIndices) {
    let raddecBuf = Buffer.from(raddec.encodeAsHexString(this.raddecEncodingOptions), 'hex');
    let raddecHexLengthBuf = Buffer.from(('00'.repeat(4) + raddecBuf.length.toString(16)).substr(-8), 'hex');
    let raddecBuffer = Buffer.concat([DEFAULT_TCP_MSG_LENGTH_OPENING_BUFFER, raddecHexLengthBuf, DEFAULT_TCP_MSG_LENGTH_CLOSING_BUFFER, raddecBuf],
                                     DEFAULT_TCP_MSG_LENGTH_OPENING_BUFFER.length + raddecHexLengthBuf.length + DEFAULT_TCP_MSG_LENGTH_CLOSING_BUFFER.length + raddecBuf.length);

    if (Array.isArray(targetIndices)) {
      // Send to a subset of targets
      targetIndices.filter((t) => t < this.targets.length).forEach((targetIndex) => {
        if (this.targets[targetIndex] !== null) {
          this.targets[targetIndex].write(raddecBuffer, (err) => {
              this.tcpForwardCallback(err, raddec, this.targets[targetIndex].remoteAddress, this.targets[targetIndex].remotePort);
            }
          );
        } else {
          this.tcpDroppedRaddec();
        }
      });
    } else {
      // Send to all targets
      this.targets.forEach((target) => {
        if (target !== null) {
          target.write(raddecBuffer, (err) => {
              this.tcpForwardCallback(err, raddec, target.remoteAddress, target.remotePort);
            }
          );
        } else {
          this.tcpDroppedRaddec();
        }
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
 */
function createRaddecListener(instance, sourceId, address, port) {
  instance.sources[sourceId] = net.createServer((socket) => {
    instance.tcpServerClientConnectedCallback(socket.remoteAddress, socket.remotePort);

    // Assuming here that we a received message always starts at the beginning of a raddec TCP message
    // Otherwise, need to move prev_msg to before socket.on(...)
    socket.on('data', (msg) => {
      let msg_str = msg.toString('hex');
      let prev_msg = '';
      // Remove the first string before DEFAULT_TCP_MSG_LENGTH_OPENING_HEX (hence the slice(1))
      msg_str_split = msg_str.split(DEFAULT_TCP_MSG_LENGTH_OPENING_HEX);
      if (msg_str_split[1].length > 0) {
        instance.tcpServerRaddecErrorCallback('TCP error: message does not start with a raddec', msg_str_split[1]);
      }
      msg_str_split.slice(1).forEach((cur_msg) => {
          new_msg = prev_msg + cur_msg;
          prev_msg = '';
          // Look for the closing flag
          if (new_msg.substr(8, 6) === DEFAULT_TCP_MSG_LENGTH_CLOSING_HEX) {
            let n = parseInt(new_msg.substr(0, 8), 16);
            if (new_msg.length == 8 + 6 + 2 * n) {
              // Jackpot!
              try {
                let raddec = new Raddec(new_msg.substr(14));

                if(raddec !== null) {
                  instance.handleSourceRaddec(raddec);
                }
              } catch(error) {
                instance.tcpServerRaddecErrorCallback(error, new_msg.substr(14));
              };
            } else if (new_msg.length > 8 + 6 + 2 * n) {
              // The detected raddec is longer than the TCP raddec length: discard
              instance.tcpServerRaddecErrorCallback('TCP error: raddec too long.', new_msg);
            } else {
              // Maybe the raddec contains the unlikely string RAD, keep to append the next one.
              prev_msg = new_msg + DEFAULT_TCP_MSG_LENGTH_OPENING_HEX;
            }
          } else {
            // Missing closing flag: discard
            instance.tcpServerRaddecErrorCallback('TCP error: Impossible to identify the raddec.', new_msg);
          }
        });
    });

    socket.on('close', (hadError) => instance.tcpServerConnectionClosedCallback(hadError, socket.remoteAddress, socket.remotePort));
    
    socket.on('error', (error) => {
      instance.tcpServerSocketErrorCallback(error, socket.remoteAddress, socket.remotePort);
    });
  });

  instance.sources[sourceId].listen(port, address, () => instance.tcpServerListeningCallback(address, port));
  
  instance.sources[sourceId].on('close', () => createRaddecListener(instance, sourceId, address, port));
}



/**
 * Create a TCP socket to send raddecs to the given target and to handle with the given function.
 * @param {RaddecRelayTcp} instance The relay instance.
 * @param {String} address The given address to connect the socket to.
 * @param {Number} port The given port to connect the socket to.
 */
function createRaddecSender(instance, targetId, address, port) {
  instance.targets[targetId] = new net.Socket();
  
  instance.targets[targetId].on('error', (error) => instance.tcpClientSocketError(error, address, port));
  instance.targets[targetId].on('close', (hadError) => {
      instance.tcpClientConnectionClosed(hadError, address, port);
      instance.targets[targetId] = null;
      setTimeout(createRaddecSender, instance.retryTargetTimeout, instance, targetId, address, port);
    });

  instance.targets[targetId].connect(port, address, () => instance.tcpClientReadyCallback(address, port));
}


module.exports = RaddecRelayTcp;
