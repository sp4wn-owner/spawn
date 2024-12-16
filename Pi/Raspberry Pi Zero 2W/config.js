// ENTER USERNAME AND PASSWORD HERE
const username = ""; // Username should be all lowercase
const password = "";

// SECURITY PARAMETERS
const allowAllUsers = true; // true to allow all users to connect to your robot || false to only allow users specified in 'allowedUsers' #default is true
const allowedUsers = ['user1', 'user2']; // Update this if you'd like to restrict access to specific usernames
const allowPrivateToggle = true; // true to automatically update 'isPrivate' from the Spawn platform || false disables automatic updates of 'isPrivate' #default is true
const isPrivate = false; // true to secure with secret code || false to allow access without secret code #default is false
const handleSecretCodeAuth = false; // true to handle secret code authentication on this device || false to handle on our server #default is false
const secretCode = ""; // update this to set your secret code for handling authentication locally
const isVisible = true; //true to add your robot to the public live feed || false prevents your robot from showing up in the public live feed. You'll need to follow your robot to see it in the feed (in this example your username doubles as a private key). To access on Spawn go to https://sp4wn.com/[username]

// HARDWARE CONFIGURATION
const gpioPins = [27, 22, 23, 24];
const pwmChannels = [0, 1]; // These channels are configured in config.txt. RPI Zero 2W has two hardware PWM channels (0,1)
const period = 20000000; // 20 ms period (50 Hz)
const dutyCycle = 0; // 1 ms duty cycle (5%)

// Export variables
module.exports = {
  username,
  password,
  allowAllUsers,
  allowedUsers,
  allowPrivateToggle,
  isPrivate,
  handleSecretCodeAuth,
  secretCode,
  isVisible,
  gpioPins,
  pwmChannels,
  period,
  dutyCycle
};
