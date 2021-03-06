var _ = require('underscore');

module.exports = function(RED) {

  function ChatBotConversation(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.chatId = config.chatId;
    this.transport = config.transport;

    this.on('input', function(msg) {

      var chatId = node.chatId;
      var transport = node.transport;
      var id = null;

      // if valid chat id then use it, otherwise search as username
      if (chatId != null && chatId.match(/^[0-9]*$/)) {
        id = chatId;
      }

      if (id == null) {
        node.error('chatId is null or username was not found');
        return;
      }

      // ensure the original message is injected
      msg.originalMessage = {
        chat: {
          id: id
        },
        message_id: null,
        transport: transport
      };

      node.send(msg);
    });

  }

  RED.nodes.registerType('chatbot-conversation', ChatBotConversation);
};
