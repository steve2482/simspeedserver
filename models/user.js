const mongoose = require('mongoose');

// user schema
const userSchema = mongoose.Schema({
  name: String,
  userName: String,
  password: String,
  favoritedChannels: Array
});

const User = mongoose.model('User', userSchema);

module.exports = {User};