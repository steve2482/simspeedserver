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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser());
app.use(passport.initialize());


// ===========================================================================
// DATABASE SETUP=============================================================
// ===========================================================================

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const {PORT, DATABASE_URL} = require('./config');
const {Channel} = require('./models/channel');
const User = require('./models/user');

// ===========================================================================
// PASSPORT SETUP=============================================================
// ===========================================================================

// Express Session============================================================
// ===========================================================================
app.use(session({
  secret: 'secret',
  saveUninitialized: false,
  resave: true,
  cookie: {
    maxAge: 60 * 60 * 1000
  },
  rolling: true
}));
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

// User Registration=======================================================
// ========================================================================
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
  let existingUser;
  User.find({email: req.body.email})
  .then(existingUser => {
    if (errors) {
    res.status(400).json(errors);
    }
    else if (existingUser.length > 0) {
      const message = [{msg: 'An account already exists with provided email address.'}];
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
app.post('/login',
  passport.authenticate('local'),
  function(req, res) {
    res.status(200).json(req.user);
  });

// User Logout================================================================
// ===========================================================================
app.get('/logout', function(req, res) {
  req.logout();
  req.session.destroy(function(err) {
    if (err) { return next(err); }
    // The response should indicate that the user is no longer authenticated.
    return res.send({ authenticated: req.isAuthenticated() });
  });   
});

// ===========================================================================
// APPLICATION API============================================================
// ===========================================================================

// Get channel names==========================================================
// ===========================================================================
app.get('/channel-names', (req, res) => {
  Channel.find().sort({'abreviatedName': 1})
  .then(data => {
    // const channelNames = [];
    // for (let i = 0; i < data.length; i++) {
    //   channelNames.push(data[i].abreviatedName);
    // }
    res.status(200).json(data);
  });
});

// Get current live feeds=====================================================
// ===========================================================================
app.get('/live', (req, res) => {
  Channel.find()
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

// Get Single Channel Results=================================================
// ===========================================================================
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

// User Favorite a Channel====================================================
// ===========================================================================
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

// User UNFavorite a Channel==================================================
// ===========================================================================
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

// ===========================================================================
// SERVER SETUP===============================================================
// ===========================================================================

// Start Server===============================================================
// ===========================================================================
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

// Close Server===============================================================
// ===========================================================================
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

// export for testing========================================================
module.exports = {app, runServer, closeServer};
