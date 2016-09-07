var _ = require('underscore');
var moment = require('moment');
var SmoochCore = require('smooch-core');
var ChatContext = require('./lib/chat-context.js');
var ChatLog = require('./lib/chat-log.js');
var helpers = require('./lib/helpers/smooch.js');
var fs = require('fs');
var os = require('os');
var request = require('request').defaults({ encoding: null });
var https = require('https');
var http = require('http');
var events = require('events');
var clc = require('cli-color');

var DEBUG = true;
var green = clc.greenBright;
var white = clc.white;
var red = clc.red;
var grey = clc.blackBright;



function SmoochBot(params) {

  var _events = {};

  // using app token
  var smoochCore = new SmoochCore({
    keyId: 'app_57cee0052fee375e00cc7345',
    secret: 'LL9VVOUNrTRPp3cSQf2la9Hd',
    scope: 'app', // app or appUser
  });


  var api = {

    on: function(eventName, callback) {
      if (_events[eventName] == null) {
        _events[eventName] = [];
      }
      _events[eventName].push(callback);
    },

    emit: function(eventName, obj) {
      if (_events[eventName] != null) {
        _events[eventName].forEach(function(callback) {
          callback(obj);
        });
      }
    },

    sendMessage: function(chatId, text, handleError) {
      smoochCore.appUsers.sendMessage(chatId, {
        text: text,
        role: 'appMaker'
      }).then(function(result) {
        // do nothing
      }).catch(function(err) {
        handleError(err);
        console.log('err---', err);
      });
    },

    sendActions: function(chatId, text, actions) {
      actions = [
        {"type": "reply", "text": "Burger King", "payload": "BURGER_KING" },
        {"type": "reply", "text": "Pizza Hut", "payload": "PIZZA_HUT"}
      ];

      return smoochCore.appUsers.sendMessage(chatId, {
        text: text,
        actions: actions,
        role: 'appMaker'
      });
    },


    uploadImage: function(chatId, image, handleError) {

      return new Promise(function(resolve, reject) {
        params = _.extend({
          recipient: null,
          filename: 'tmp-file',
          token: null,
          buffer: null,
          type: 'image'
        }, params);

        var tmpFile = os.tmpdir() + '/' + params.filename;

        // write to filesystem to use stream
        fs.writeFile(tmpFile, image, function(err) {
          if (err) {
            reject(err);
          } else {
            // prepare payload
            var filedata = null;
            switch(params.type) {
              case 'image':
                filedata = {
                  value: fs.createReadStream(tmpFile),
                  options: {
                    filename: params.filename,
                    contentType: 'image/png' // fix extension
                  }
                };
                break;
              case 'audio':
                filedata = {
                  value: fs.createReadStream(tmpFile),
                  options: {
                    filename: params.filename,
                    contentType: 'audio/mp3'
                  }
                };
                break;
            }
            // upload and send
            var formData = {
              role: 'appMaker',
              name: 'steve',
              source: filedata
            };

            request.post({
              url: 'https://api.smooch.io/v1/appusers/' + chatId + '/images',
              headers: {
                'Authorization': smoochCore.authHeaders.Authorization,
                'Content-Type': 'application/json'
              },
              formData: formData
            }, function(err, response, body) {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          }
        }); // end writeFile
      });
    },


    /*uploadImage: function(chatId, image, handleError) {
      console.log('mando image', chatId);
      smoochCore.appUsers.uploadImage(chatId, image).then(function(result) {
        // do nothing
      }).catch(function(err) {
        handleError(err);
        console.log('err---', err);
      });
    },*/


    middleware: function () {

      return function(req, res) {

        // we always write 200, otherwise facebook will keep retrying the request
        res.writeHead(200, { 'Content-Type': 'application/json' })
        //if (req.url === '/_status') return res.end(JSON.stringify({status: 'ok'}))
        //if (this.verify_token && req.method === 'GET') return this._verify(req, res)
        if (req.method !== 'POST') return res.end();

        var body = '';
        req.on('data', function(chunk) {
          body += chunk
        });

        req.on('end', function() {
          var parsed = JSON.parse(body);
          res.end(JSON.stringify({status: 'ok'}));

          if (parsed.trigger === 'message:appUser') {
            parsed.messages.forEach(function(message) {
              api.emit('message', message);
            });
          }

        });
      }

    }

  };

  return api;

};



module.exports = function(RED) {

  function SmoochBotNode(n) {
    RED.nodes.createNode(this, n);

    var self = this;
    this.botname = n.botname;
    this.log = n.log;

    this.usernames = [];
    if (n.usernames) {

      this.usernames = _(n.usernames.split(',')).chain()
        .map(function(userId) {
          return userId.match(/^[a-zA-Z0-9_]+?$/) ? userId : null
        })
        .compact()
        .value();
    }


    this.handleMessage = function(botMsg) {


      var facebookBot = self.bot;

      if (DEBUG) {
        console.log('START:-------');
        console.log(botMsg);
        console.log('END:-------');
      }

      // mark the original message with the platform
      botMsg.transport = 'smooch';

      var userId = botMsg.authorId;
      var chatId = botMsg.authorId;
      var messageId = botMsg._id;
      var context = self.context();
      // todo fix this
      //var isAuthorized = node.config.isAuthorized(username, userId);
      var isAuthorized = true;

      // get or create chat id
      var chatContext = context.global.get('chat:' + chatId);
      if (chatContext == null) {
        chatContext = ChatContext(chatId);
        context.global.set('chat:' + chatId, chatContext);
      }

      // decode the message, eventually download stuff
      self.getMessageDetails(botMsg, self.bot)
        .then(function(payload) {
          // store some information
          chatContext.set('chatId', chatId);
          chatContext.set('messageId', messageId);
          chatContext.set('userId', userId);
          chatContext.set('firstName', botMsg.name);
          chatContext.set('lastName', null);
          chatContext.set('authorized', isAuthorized);
          chatContext.set('transport', 'smooch');
          chatContext.set('message', botMsg.text);

          var chatLog = new ChatLog(chatContext);

          return chatLog.log({
            payload: payload,
            originalMessage: {
              transport: 'smooch',
              chat: {
                id: chatId
              }
            }
          }, self.log)
        })
        .then(function (msg) {

          var currentConversationNode = chatContext.get('currentConversationNode');
          // if a conversation is going on, go straight to the conversation node, otherwise if authorized
          // then first pin, if not second pin
          if (currentConversationNode != null) {
            // void the current conversation
            chatContext.set('currentConversationNode', null);
            // emit message directly the node where the conversation stopped
            RED.events.emit('node:' + currentConversationNode, msg);
          } else {
            facebookBot.emit('relay', msg);
          }

        })
        .catch(function (error) {
          facebookBot.emit('relay', null, error);
        });
    };


    if (this.credentials) {
      this.token = this.credentials.token;
      this.app_secret = this.credentials.app_secret;
      this.verify_token = this.credentials.verify_token;
      this.key_pem = this.credentials.key_pem;
      this.cert_pem = this.credentials.cert_pem;
      if (this.token) {
        this.token = this.token.trim();

        if (!this.bot) {
          // todo move to config
          this.bot = new SmoochBot({
            token: this.token, // todo fix here
            /*verify: this.verify_token,
            app_secret: this.app_secret,
            key_pem: this.key_pem,
            cert_pem: this.cert_pem*/
          });

          console.log('');
          console.log(grey('------ Smooch Webhook ----------------'));
          if (this.key_pem != null && this.cert_pem) {
            try {
              var options = {
                key: fs.readFileSync(this.key_pem),
                cert: fs.readFileSync(this.cert_pem)
              };
            } catch(e) {
              var message = 'Facebook receiver: error loading certificate files ('
                + this.key_pem + ',' + this.cert_pem + ')';
              console.log(red(message));
              this.error(message);
              return;
            }
            console.log(green('Using SSL: ') + white('yes'));
            console.log(green('Webhook URL: ') + white('https://localhost:3199'));
            console.log(green('Key PEM: ') + white(this.key_pem));
            console.log(green('Cert PEM: ') + white(this.cert_pem));
            this.server = https.createServer(options, this.bot.middleware()).listen(3199);
          } else {
            console.log(green('Using SSL: ') + white('no'));
            console.log(green('Webhook URL: ') + white('http://localhost:3199'));
            this.server = http.createServer(this.bot.middleware()).listen(3199);
          }
          console.log('');

          this.bot.on('message', this.handleMessage);
        }
      }
    }

    this.on('close', function (done) {
      self.server.close(function() {
        done();
      });
    });

    this.isAuthorized = function (username, userId) {
      if (self.usernames.length > 0) {
        return self.usernames.indexOf(username) != -1 || self.usernames.indexOf(String(userId)) != -1;
      }
      return true;
    };

    // creates the message details object from the original message
    this.getMessageDetails = function (message, bot) {

      return new Promise(function (resolve, reject) {

        var userId = message.authorId;
        var chatId = message.authorId;
        var messageId = message._id;

        if (message.mediaUrl != null && message.mediaType.indexOf('image') !== -1) {

          helpers.downloadFile(message.mediaUrl)
            .then(function(buffer) {
              console.log('immagine scaricata', buffer);
              resolve({
                chatId: chatId,
                messageId: messageId,
                type: 'photo',
                content: buffer,
                date: moment(message.received),
                inbound: true
              });
            })
            .catch(function() {
              reject('Unable to download ' + message.mediaUrl);
            });
        } else if (!_.isEmpty(message.text)) {
          resolve({
            chatId: chatId,
            messageId: messageId,
            type: 'message',
            content: message.text,
            date: moment(message.received),
            inbound: true
          });
        }


      });
    }

  }

  RED.nodes.registerType('chatbot-smooch-node', SmoochBotNode, {
    credentials: {
      token: {
        type: 'text'
      },
      app_secret: {
        type: 'text'
      },
      key_pem: {
        type: 'text'
      },
      cert_pem: {
        type: 'text'
      }
    }
  });

  function SmoochInNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.bot = config.bot;

    this.config = RED.nodes.getNode(this.bot);
    if (this.config) {
      this.status({fill: 'red', shape: 'ring', text: 'disconnected'});

      node.bot = this.config.bot;

      if (node.bot) {
        this.status({fill: 'green', shape: 'ring', text: 'connected'});

        node.bot.on('relay', function(message, error) {
          if (error != null) {
            node.error(error);
          } else {
            node.send(message);
          }
        });

      } else {
        node.warn("no bot in config.");
      }
    } else {
      node.warn('Missing configuration in Facebook Messenger Receiver');
    }
  }
  RED.nodes.registerType('chatbot-smooch-receive', SmoochInNode);


  function SmoochOutNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.bot = config.bot;
    this.track = config.track;

    this.config = RED.nodes.getNode(this.bot);
    if (this.config) {
      this.status({fill: 'red', shape: 'ring', text: 'disconnected'});

      node.bot = this.config.bot;

      if (node.bot) {
        this.status({fill: 'green', shape: 'ring', text: 'connected'});
      } else {
        node.warn("no bot in config.");
      }
    } else {
      node.warn("no config.");
    }

    function sendMessage(msg) {

      return new Promise(function(resolve, reject) {

        var type = msg.payload.type;
        var bot = node.bot;
        var credentials = node.config.credentials;

        var reportError = function(err) {
          if (err) {
            reject(err);
          } else {
            resolve()
          }
        };

        switch (type) {
          case 'action':

            break;

          case 'message':
            bot.sendMessage(msg.payload.chatId, msg.payload.content, reportError);
            break;

          case 'buttons':

            return bot.sendActions(msg.payload.chatId, msg.payload.content, msg.payload.actions);

            break;

          case 'audio':
            var audio = msg.payload.content;
            helpers.uploadBuffer({
              recipient: msg.payload.chatId,
              type: 'audio',
              buffer: audio,
              token: credentials.token,
              filename: msg.payload.filename
            }).catch(function(err) {
              reject(err);
            });
            break;

          case 'photo':
            var image = msg.payload.content;
            console.log('brandeggio image', msg.payload.content);
            bot.uploadImage(msg.payload.chatId, msg.payload.content, reportError);
            /*helpers.uploadBuffer({
              recipient: msg.payload.chatId,
              type: 'image',
              buffer: image,
              token: credentials.token,
              filename: msg.payload.filename
            }).catch(function(err) {
              reject(err);
            });*/
            break;

          default:
            reject('Unable to prepare unknown message type');
        }

      });
    }

    // relay message
    var handler = function(msg) {
      node.send(msg);
    };
    RED.events.on('node:' + config.id, handler);

    // cleanup on close
    this.on('close',function() {
      RED.events.removeListener('node:' + config.id, handler);
    });

    this.on('input', function (msg) {

      // check if the message is from facebook
      if (msg.originalMessage != null && msg.originalMessage.transport !== 'smooch') {
        // exit, it's not from facebook
        return;
      }

      /*f (msg.payload == null) {
        node.warn("msg.payload is empty");
        return;
      }
      if (msg.payload.chatId == null) {
        node.warn("msg.payload.channelId is empty");
        return;
      }
      if (msg.payload.type == null) {
        node.warn("msg.payload.type is empty");
        return;
      }*/

      var context = node.context();
      var track = node.track;
      var chatId = msg.payload.chatId || (originalMessage && originalMessage.chat.id);
      var chatContext = context.global.get('chat:' + chatId);

      // check if this node has some wirings in the follow up pin, in that case
      // the next message should be redirected here
      if (chatContext != null && track && !_.isEmpty(node.wires[0])) {
        chatContext.set('currentConversationNode', node.id);
        chatContext.set('currentConversationNode_at', moment());
      }

      var chatLog = new ChatLog(chatContext);

      chatLog.log(msg, this.config.log)
        .then(function () {
          sendMessage(msg);
        });

    });
  }
  RED.nodes.registerType('chatbot-smooch-send', SmoochOutNode);

};
