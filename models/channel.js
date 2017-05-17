const mongoose = require('mongoose');

// channel schema
const channelSchema = mongoose.Schema({
  abreviatedName: String,
  name: String,
  youtubeId: String,
  favorites: Number
});

const Channel = mongoose.model('Channel', channelSchema);

module.exports = {Channel};