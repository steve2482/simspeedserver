const express = require('express');
const app = express();
const cors = require('cors');
const fetch = require('isomorphic-fetch');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressValidator = require('express-validator');
const session = require('express-session');
const cookieParser = require('cookie-parser');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

app.use(express.static('public'));
var corsOptions = {
  origin: process.env.CLIENT_URL,
  optionsSuccessStatus: 200,
  credentials: true
}
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

// ===========================================================================
// DATABASE SETUP=============================================================
// ===========================================================================

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const {PORT, DATABASE_URL} = require('./config');
const Channel = require('./models/channel');
const User = require('./models/user');

// ===========================================================================
// PASSPORT SETUP=============================================================
// ===========================================================================

// Express Session============================================================
// ===========================================================================
app.use(session({
  secret: 'secret',
  saveUninitialized: false,
  resave: false,
  cookie: {
    maxAge: 60 * 60 * 1000
  },
  rolling: true
}));
app.use(passport.initialize());
app.use(passport.session());

// Express Validator==========================================================
// ===========================================================================
app.use(expressValidator({
  errorFormatter: function(param, msg, value) {
      var namespace = param.split('.')
      , root    = namespace.shift()
      , formParam = root;
 
    while(namespace.length) {
      formParam += '[' + namespace.shift() + ']';
    }
    return {
      param : formParam,
      msg   : msg,
      value : value
    };
  }
}));

// User Registration===================================================
// ====================================================================
app.post('/register', (req, res) => {
  let name = req.body.name;
  let email = req.body.email;
  let userName = req.body.userName;
  let password = req.body.password;
  let password2 = req.body.password2;

  // Validation=======================================================
  // =================================================================
  req.checkBody('name', 'Name is Required').notEmpty();
  req.checkBody('email', 'Email is Required').notEmpty();
  req.checkBody('email', 'Email is not valid').isEmail();
  req.checkBody('userName', 'Username is required').notEmpty();
  req.checkBody('password', 'Password is required').notEmpty();
  req.checkBody('password2', 'Passwords do not match').equals(req.body.password);

  let errors = req.validationErrors();
  User.find({email: req.body.email})
  .then(existingUser => {
    if (errors) {
    res.status(400).json(errors);
    }
    if (existingUser.length > 0) {
      const message = [{msg: 'An account already exists with provided email address.'}];
      res.status(400).json(message);
    }
    User.find({userName: req.body.userName})
    .then(user => {
      if (user.length > 0) {
        const message = [{msg: 'That Username is taken, please choose a different username.'}];
        res.status(400).json(message);
      }
      else {
        let newUser = new User({
          name: name,
          email: email,
          userName: userName,
          password: password,
          favoriteChannels: []
        });
        User.createUser(newUser, function(err, user) {
          if (err) throw err;
          req.login(user, function(err) {
            if (err) {
              throw err;
            } else {
              res.status(200).json(user);
            }
          });
        });
      }
    })         
  })  
});

// Sign in strategy===================================================
// ===================================================================
passport.use(new LocalStrategy(
  function(userName, password, done) {
    User.getUserByUsername(userName, function(err, user) {
      if (err) {
        throw err;
      }
      if (!user) {
        return done(null, false, {message: 'Unknown user'});
      }
      User.comparePassword(password, user.password, function(err, isMatch) {
        if (err) {
          throw err;
        }
        if (isMatch) {
          return done(null, user);
        } else {
          return done(null, false, {message: 'Invalid password'});
        }
      });
    });
  }));

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.getUserById(id, function(err, user) {
    done(err, user);
  });
});

// User Login=========================================================
// ===================================================================
app.post('/login', function(req, res, next) {
  passport.authenticate('local', function(err, user, info) {
    if (err) {return next(err);}
    if (!user) {
      const message = [{msg: info.message}]
      console.log(message);
      res.status(400).json(message);
    }
    req.logIn(user, function(err) {
      if (err) {
        return next(err);
      }
      res.status(200).json(req.user);
    });
  })(req, res, next);
});

// User Logout=========================================================
// ====================================================================
app.get('/logout', function(req, res) {
  req.logout();
  req.session.destroy(function(err) {
    if (err) { return next(err); }
    // The response should indicate that the user is no longer authenticated.
    return res.send({ authenticated: req.isAuthenticated() });
  });   
});

// ====================================================================
// APPLICATION API=====================================================
// ====================================================================

// Get channel names===================================================
// ====================================================================
app.get('/channel-names', (req, res) => {
  return Channel.find().sort({'abreviatedName': 1})
  .then(data => {
    // const channelNames = [];
    // for (let i = 0; i < data.length; i++) {
    //   channelNames.push(data[i].abreviatedName);
    // }
    res.status(200).json(data);
  });
});

// Get current live feeds==============================================
// ====================================================================
app.get('/live', (req, res) => {
  return Channel.find()
  .then(data => {
    let apiKey = process.env.YOUTUBE_API_KEY;
    const urls = [];
    for (let i = 0; i < data.length; i++) {
      urls.push(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${data[i].youtubeId}&eventType=live&type=video&key=${apiKey}`);
    }
    Promise.all(
      urls.map(urls => fetch(urls))
    )
    .then(response => Promise.all(response.map(response => response.json())))
    .then(response => res.json(response));
  })
  .catch(err => {
    console.log(err);
  });
});

// Get upcoming broadcasts=============================================
// ====================================================================
app.get('/upcoming', (req,res) => {
  // Find channels and build requests for upcoming broadcasts
  return Channel.find()
  .then(data => {
    let apiKey = process.env.YOUTUBE_API_KEY;
    const urls = [];
    for (let i = 0; i < data.length; i++) {
      urls.push(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${data[i].youtubeId}&eventType=upcoming&type=video&maxResults=50&key=${apiKey}`);
    }
    // Fetch requests
    Promise.all(
      urls.map(urls => fetch(urls))
    )
    .then(response => Promise.all(response.map(response => response.json())))
    .then(response => {
      // Sort through each channel for upcoming broadcasts while building request for upcoming broadcast information      
      let videoUrlRequests = [];
      for (let i = 0; i < response.length; i++) {
        for (let x = 0; x < response[i].items.length; x++) {
          videoUrlRequests.push(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${response[i].items[x].id.videoId}&key=${apiKey}`);        
        }
      }
      // Fetch requests for each upcoming video
      Promise.all(videoUrlRequests.map(videoUrlRequests => fetch(videoUrlRequests)))
      .then(response => Promise.all(response.map(response => response.json())))
      .then(response => {
        // Organize the data wanted into an array
        let data = [];
        for (let i = 0; i < response.length; i++) {
          let eachUpcomingVideo = {
            channelTitle: response[i].items[0].snippet.channelTitle,
            title: response[i].items[0].snippet.title,
            thumbnail: response[i].items[0].snippet.thumbnails.medium.url,
            date: new Date(response[i].items[0].liveStreamingDetails.scheduledStartTime).toUTCString(),
            videoId: response[i].items[0].id
          };
          data.push(eachUpcomingVideo);
        }
        // Sort by Date
        data.sort((a, b) => {
          return new Date(a.date) - new Date(b.date);
        });
        // Remove upcoming videos with dates prior to now
        const cleanData = data.filter(videoInfo => {
          return new Date(videoInfo.date) > new Date;
        });
        // Send only the next 8 broadcasts
        finalData = cleanData.slice(0, 8);
        res.json(finalData);
      });
    });
  })
  .catch(err => {
    console.log(err);
  });
});

// Get Single Channel Upcoming Broadcasts==============================
// ====================================================================
app.post('/channel-upcoming', (req, res) => {
  // Find channel info
  Channel.find({abreviatedName: req.body.channelName})
  .then(data => {
    // Set request URL
    let apiKey = process.env.YOUTUBE_API_KEY;
    let channelId = data[0].youtubeId;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=upcoming&type=video&maxResults=50&key=${apiKey}`;
    let request = new Request(url, {
      method: 'GET',
      headers: new Headers()
    });
    return fetch(request)
    .then(response => response.json())
    .then(response => {
      // Sort through each channel for upcoming broadcasts while building request for upcoming broadcast information      
      let videoUrlRequests = [];
      for (let i = 0; i < response.items.length; i++) {
          videoUrlRequests.push(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${response.items[i].id.videoId}&key=${apiKey}`);        
      }
      // Fetch requests for each upcoming video
      Promise.all(videoUrlRequests.map(videoUrlRequests => fetch(videoUrlRequests)))
      .then(response => Promise.all(response.map(response => response.json())))
      .then(response => {
        // Organize the data wanted into an array
        let data = [];
        for (let i = 0; i < response.length; i++) {
          let eachUpcomingVideo = {
            channelTitle: response[i].items[0].snippet.channelTitle,
            title: response[i].items[0].snippet.title,
            thumbnail: response[i].items[0].snippet.thumbnails.medium.url,
            date: new Date(response[i].items[0].liveStreamingDetails.scheduledStartTime).toUTCString(),
            videoId: response[i].items[0].id
          };
          data.push(eachUpcomingVideo);
        }
        // Sort by Date
        data.sort((a, b) => {
          return new Date(a.date) - new Date(b.date);
        });
        // Remove upcoming videos with dates prior to now
        const cleanData = data.filter(videoInfo => {
          return new Date(videoInfo.date) > new Date;
        });
        // Send only the next 4 broadcasts
        finalData = cleanData.slice(0, 4);
        res.json(finalData);
      });      
    });
  })
  .catch(err => {
    console.log(err);
  });
});

// Get Single Channel Results==========================================
// ====================================================================
app.post('/channel-videos', (req, res) => {
  Channel.find({abreviatedName: req.body.channelName})
  .then(data => {
    let apiKey = process.env.YOUTUBE_API_KEY;
    let channelId = data[0].youtubeId;
    let url;
    if (req.body.nextPageToken) {
      url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=12&eventType=completed&pageToken=${req.body.nextPageToken}&key=${apiKey}`;
    } else {
      url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=12&eventType=completed&key=${apiKey}`;
    }    
    let request = new Request(url, {
      method: 'GET',
      headers: new Headers()
    });
    return fetch(request)
    .then(response => response.json())
    .then(response => res.json(response));
  })
  .catch(err => {
    console.log(err);
  });
});

// User Favorite a Channel=============================================
// ====================================================================
app.post('/favorite-channel', (req, res) => {
  return User.update(
    {userName: req.body.userName},
    {$push: {favoriteChannels: req.body.channel}}
  )
  .then(() => {
    return Channel.update(
      {abreviatedName: req.body.channel},
      {$inc: {favorites: 1}}
    )
  })
  .then(() => {
    res.json(req.body.channel);
  })
  .catch(err => console.log(err));
});

// User UNFavorite a Channel===========================================
// ====================================================================
app.post('/remove-channel', (req, res) => {
  return User.update(
    {userName: req.body.userName},
    {$pull: {favoriteChannels: req.body.channel}}
  )
  .then(() => {
    return Channel.update(
      {abreviatedName: req.body.channel},
      {$inc: {favorites: -1}}
    )
  })
  .then(() => {
    res.json(req.body.channel);
  })
  .catch(err => console.log(err));
})

// ====================================================================
// SERVER SETUP========================================================
// ====================================================================

// Start Server========================================================
// ====================================================================
let server;

function runServer(databaseUrl=DATABASE_URL, port=PORT) {
  return new Promise((resolve, reject) => {
    mongoose.connect(databaseUrl, err => {
      if (err) {
        return reject(err);
      }

      server = app.listen(port, () => {
        console.log(`App is connected to server on port ${port}`);
        resolve();
      })
      .on('error', err => {
        mongoose.disconnect();
        reject(err);
      });
    });
  });
}

// Close Server========================================================
// ====================================================================
function closeServer() {
  return mongoose.disconnect().then(() => {
    return new Promise((resolve, reject) => {
      console.log('Closing Server');
      server.close(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
}

if (require.main === module) {
  runServer().catch(err => console.error(err));
};

// export for testing==================================================
module.exports = {app, runServer, closeServer};
