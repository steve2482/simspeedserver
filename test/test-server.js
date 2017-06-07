const chai = require('chai');
const chaiHttp = require('chai-http');
const should = chai.should();
const expect = chai.expect;
const mongoose = require('mongoose');
const nock = require('nock');
const faker = require('faker');
const bcrypt = require('bcryptjs');

mongoose.Promise = global.Promise;

const {app, runServer, closeServer} = require('../server');
const User = require('../models/user');
const Channel = require('../models/channel');
const {TEST_DATABASE_URL} = require('../config');

chai.use(chaiHttp);

const NUMBER_OF_CHANNELS = 10;

// Generate a User====================================================
// ===================================================================
function generateUser() {
  return new User({
    name: faker.name.firstName(),
    email: faker.internet.email(),
    userName: faker.internet.userName(),
    password: faker.internet.password(),
    favoriteChannels: ['Channel']
  });
}

// Generate Channel===================================================
// ===================================================================
function generateChannel() {
  return new Channel({
    abreviatedName: faker.company.companyName(),
    name: faker.company.companyName(),
    youtubeId: '1234',
    favorites: faker.random.number()
  });
}

// Add data to test with==============================================
// ===================================================================
function seedUsers() {
  console.log('Creating user data');
  const data = [];
  for (let i = 0; i < 10; i++) {
    data.push(generateUser());
  }
  return User.insertMany(data);
}

function seedChannels() {
  console.log('Creating channel data');
  const data = [];
  for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
    data.push(generateChannel());
  }
  return Channel.insertMany(data);
}

// Clear test data base===============================================
// ===================================================================
function clearDatabase() {
  console.log('Deleting Database');
  return mongoose.connection.dropDatabase();
}

// ===================================================================
// TESTS==============================================================
// ===================================================================
describe('Testing Sever', () => {

  before(() => {
    return runServer(TEST_DATABASE_URL);
  });

  beforeEach(() => {
    return Promise.all([
      seedUsers(),
      seedChannels()
    ]);
  });

  afterEach(() => {
    return clearDatabase();
  });

  after(() => {
    return closeServer();
  });

  // Test User Registers Correctly====================================
  // =================================================================
  describe('User Registration', () => {
    it('Should register the user and store in the database', () => {
      let password = faker.internet.password();
      let newUser = {
        name: faker.name.firstName(),
        email: faker.internet.email(),
        userName: faker.internet.userName(),
        password: password,
        password2: password
      };
      return chai.request(app)
      .post('/register')
      .send(newUser)
      .then(response => {
        const emptyFavChannelsArray = [];
        expect(response).to.have.status(200);
        expect(response.body.name).to.equal(newUser.name);
        expect(response.body.email).to.equal(newUser.email);
        expect(response.body.userName).to.equal(newUser.userName);
        expect(response.body.favoriteChannels).to.deep.equal(emptyFavChannelsArray);
        bcrypt.compare(password, response.body.password, (err, match) => {
          expect(match).to.be.true;
        });
      });
    });
  });

  // Test User Login==================================================
  // =================================================================
  describe('User Login', () => {
    it('Should log in the user', () => {
      User.findOne()
      .then(user => {
        const credentials = {
          userName: user.userName,
          password: user.password
        };
        return chai.request(app)
        .post('login')
        .send(credentials)
        .then(response => {
          expect(response).to.have.status(200);
          expect(response.body).to.equal(user);
        });
      });
    });
  });

  // Test Server returns the channel names============================
  // =================================================================
  describe('Get Channel Names', () => {
    it('Should return the list of channel names', () => {
      return chai.request(app)
      .get('/channel-names')
      .then(response => {
        expect(response.body).to.have.length(10);
        expect(response.body[0]).to.include.keys('abreviatedName', 'name', 'youtubeId', 'favorites');
      });
    });
  });

  // Test Live Broadcasts are returned================================
  // =================================================================
  describe('Get Live Broadcasts', () => {
    describe('getLiveBroadcastData', () => {
      let apiKey = process.env.YOUTUBE_API_KEY;
      let youtubeApi;
      const item = [
          {
            channelResults: 1
          },
          {
            channelResults: 2
          }
        ];
      let expectedJson = [];

        for (let i = 0; i < NUMBER_OF_CHANNELS; i++) {
          expectedJson.push(item);
        }

      beforeEach(() => {
        youtubeApi = nock('https://www.googleapis.com/youtube/v3/search')
        .persist()
        .get('')
        .query({
          key: apiKey,
          part: 'snippet',
          channelId: '1234',
          eventType: 'live',
          type: 'video'
        })
        .reply(200, item);
      });

      it('Should return the list of live broadcasts', () => {
        return chai.request(app)
        .get('/live')
        .then(response => {
          response.should.have.status(200);
          expect(youtubeApi.isDone()).to.be.true;
          expect(response.body).to.deep.equal(expectedJson);
        });
      });
    });    
  });

  // Get Channel Past Videos==========================================
  // =================================================================
  describe('Get Channel Videos', () => {
    describe('getChannelVideosData', () => {
      let apiKey = process.env.YOUTUBE_API_KEY;
      let youtubeApi;
      const expectedJson = [
        {
          videoResults: 1
        },
        {
          videoResults: 2
        }
      ];

      beforeEach(() => {
        youtubeApi = nock('https://www.googleapis.com/youtube/v3/search')
        .persist()
        .get('')
        .query({
          key: apiKey,
          part: 'snippet',
          channelId: '1234',
          order: 'date',
          eventType: 'completed',
          type: 'video',
          maxResults: 12
        })
        .reply(200, expectedJson);
      });

      it('Should return specific channel videos', () => {
        return Channel.findOne()
        .then(channel => {
          const channelName = {
            channelName: channel.abreviatedName
          };
          return chai.request(app)
          .post('/channel-videos')
          .send(channelName)
          .then(response => {
            expect(response.body).to.deep.equal(expectedJson);
          });
        });
      });  
    });    
  });

  // User Favorites a Channel=========================================
  // =================================================================
  describe('User Favorites Channel', () => {
    it('Should add channel to user favorites list and increment channel\'s favorite count', () => {
      let payload = {
        userName: '',
        channel: ''
      };
      return User.findOne()
      .then(user => {
        payload.userName = user.userName;
      })
      .then(() => {
        return Channel.findOne()
        .then(channel => {
          payload.channel = channel.abreviatedName;
          let favoriteCount = channel.favorites;
          return chai.request(app)
          .post('/favorite-channel')
          .send(payload)
          .then(response => {
            expect(response).to.have.status(200);
            expect(response.body).to.equal(payload.channel);
          })
          .then(() => {
            return User.find({userName: payload.userName})
            .then(user => {
              expect(user[0].favoriteChannels).to.include(payload.channel);
            })
            .then(() => {
              return Channel.find({abreviatedName: payload.channel})
              .then(channel => {
                expect(channel[0].favorites).to.equal(favoriteCount + 1);
              });
            });
          });
        });
      });
    });
  });

  describe('User Unfavorites a Channel', () => {
    it('Should remove the channel from the user\'s favorite list, and decrement', () => {
      let payload = {
        userName: '',
        channel: ''
      };
      return User.findOne()
      .then(user => {
        payload.userName = user.userName;
      })
      .then(() => {
        return Channel.findOne()
        .then(channel => {
          payload.channel = channel.abreviatedName;
          let favoriteCount = channel.favorites;
          return chai.request(app)
          .post('/remove-channel')
          .send(payload)
          .then(response => {
            expect(response).to.have.status(200);
            expect(response.body).to.equal(payload.channel);
          })
          .then(() => {
            return User.find({userName: payload.userName})
            .then(user => {
              expect(user[0].favoriteChannels).to.not.include(payload.channel);
            })
            .then(() => {
              return Channel.find({abreviatedName: payload.channel})
              .then(channel => {
                expect(channel[0].favorites).to.equal(favoriteCount - 1);
              });
            });
          });
        });
      });
    });
  });
});

