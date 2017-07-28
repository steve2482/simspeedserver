const mongoose = require('mongoose');

// channel schema
const channelSchema = mongoose.Schema({
  abreviatedName: String,
  name: String,
  youtubeId: String,
  favorites: Number,
  type: String
});

const Channel = module.exports = mongoose.model('Channel', channelSchema);
