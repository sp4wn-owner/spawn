const WebSocket = require('ws');
const { spawn } = require('child_process');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('wrtc');
const url = 'https://sp4wn-signaling-server.onrender.com';
const pipins = require('@sp4wn/pipins');

const config = require('./config');

// Accessing the exported variables
const username = config.username;
const password = config.password;
const allowAllUsers = config.allowAllUsers;
const allowedUsers = config.allowedUsers;
const allowPrivateToggle = config.allowPrivateToggle;
let isPrivate = config.isPrivate;
const handleSecretCodeAuth = config.handleSecretCodeAuth;
const secretCode = config.secretCode;
const gpioPins = config.gpioPins;
const pwmChannels = config.pwmChannels;
const period = config.period;
const dutyCycle = config.dutyCycle;

let isStreamToSpawn = false;
let connectionTimeout;
let profilePicture;
let location;
let description;
let tokenrate;
const botdevicetype = "pi";
let peerConnection;
let signalingSocket;
let inputChannel;
let videoChannel;
let intervalIds = [];
let connectedUser;
let configuration;
let isStartingStream = false;

async function startWebRTC() {
    console.log('Starting WebRTC client...');
    await initializeSignalingAndStartCapture();

    peerConnection = new RTCPeerConnection(configuration);
    try {
        await createDataChannel('video');
        await createDataChannel('input');
    } catch (error) {
        console.log("unable to create data channels");
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            signalingSocket.send(JSON.stringify({ type: 'candidate', othername: connectedUser, candidate: event.candidate }));
            console.log("sending ice to ", connectedUser);
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) {
            console.error('Peer connection is not initialized.');
            return; 
        }

        switch (peerConnection.iceConnectionState) {
            case 'new':
                console.log('ICE Connection State is new.');
                break;
            case 'checking':
                console.log('ICE Connection is checking.');
                break;
            case 'connected':
                console.log('ICE Connection has been established.');
                break;
            case 'completed':
                console.log('ICE Connection is completed.');
                startStream();
                break;
            case 'failed':
                console.log("peer connection failed");   
                cleanup();
            case 'disconnected':
                console.log("peer disconnected");   
                cleanup();
            case 'closed':
            break;
        }
    };      
}

async function connectToSignalingServer() {
    return new Promise((resolve, reject) => {
        signalingSocket = new WebSocket(url);

        signalingSocket.onopen = () => {
            clearTimeout(connectionTimeout);
            send({
                type: "robot",
                username: username,
                password: password,
                device: botdevicetype
            });
        };

        signalingSocket.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            messageEmitter.emit(message.type, message);
            switch (message.type) {

                case "authenticated":
                    handleLogin(message.success, message.pic, message.tokenrate, message.location, message.description, message.priv, message.configuration);
                    resolve();
                    break;

                case 'offer':
                    if (peerConnection) {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);
                        signalingSocket.send(JSON.stringify({ type: 'answer', answer }));
                    } else {
                        console.log("no answer peer connection");
                    }
                    break;

                case 'answer':
                    if (peerConnection) {
                        try {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
                        } catch (error) {
                            console.error("Error when setting remote description: ", error);
                        }
                    } else {
                        console.log("no answer peer connection");
                    }
                    break;

                case 'candidate':
                    if (message.candidate) {
                        try {
                            const candidate = new RTCIceCandidate(message.candidate);
                            await peerConnection.addIceCandidate(candidate);
                            console.log('ICE candidate added successfully.');
                        } catch (error) {
                            console.error('Error adding ICE candidate:', error);
                        }
                    } else {
                        console.warn('No ICE candidate in the message.');
                    }
                    break;

                case "watch":
                    watchStream(message.name, message.pw);
                    break;
            }
        };

        signalingSocket.onclose = () => {
            console.log('Disconnected from signaling server');
            reject(new Error('WebSocket closed unexpectedly')); 
            cleanup();
        };

        signalingSocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            reject(error); 
            cleanup();
        };
    });
}

async function initializeSignalingAndStartCapture() {
    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
        console.log("Connecting to signaling server...");
        connectionTimeout = setTimeout(() => {
            console.log('Connection timed out after 15 seconds');
            cleanup();
          }, 15000);
    
        await connectToSignalingServer(); 
    }

    if (signalingSocket.readyState === WebSocket.OPEN) {
        //console.log("Connected to signaling server");        
    } else {
        console.error("Failed to connect to signaling server.");
    }
}

function send(message) {
    signalingSocket.send(JSON.stringify(message));
 };
 
function handleLogin(success, pic, tr, loc, des, priv, config) {
    if (!success) {
        console.log("User already logged in or password/username didn't match.");
        return;
    }
    if (success)  {
        console.log("Successfully logged in");
        configuration = config;
        if(pic) {
            profilePicture = pic;
        } else {
            console.log("No picture");
        }
        if(tr) {
            tokenrate = tr;
        } else {
            console.log("No token rate");
            tokenrate = 0;
        }
        if(loc) {
            location = loc;
        } else {
            console.log("No location");
        }
        if(des) {
            description = des;
        } else {
            console.log("No description");
        }
        if(allowPrivateToggle && priv) {
            isPrivate = priv;
        }
        else {
            console.log("No private status");
        }

        gpioPins.forEach(pin => {
            pipins.exportPin(pin);
            pipins.setPinDirection(pin, 'out');
            pipins.writePinValue(pin, 0);
            console.log(`GPIO pin ${pin} set as OUTPUT`);
        });
        pwmChannels.forEach(pin => {
            pipins.exportPwm(pin);
            pipins.setPwmPeriod(pin, period);
            pipins.setPwmDutyCycle(pin, dutyCycle);
            pipins.enablePwm(pin);
            console.log(`PWM pin ${pin} enabled`);
        });
        captureImage();
        startImageCapture(15000);
    }
 }

async function createDataChannel(type) {
    let dataChannel;

    try {
        dataChannel = peerConnection.createDataChannel(type);
        //console.log(`Data channel "${type}" created successfully.`);
    } catch (error) {
        console.error(`Failed to create ${type} data channel:`, error);
        return; 
    }

    if (type === 'video') {
        videoChannel = dataChannel;
        handleVideoChannel(videoChannel); 
    } else if (type === 'input') {
        inputChannel = dataChannel;
        handleInputChannel(inputChannel);
    }
}

function handleInputChannel(inputChannel) {
    const inputProcess = spawn('node', ['inputHandler.js'], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    inputChannel.onopen = () => {
        console.log('Input channel connected to peer');
        inputChannel.send('Message from input channel');
    };

    inputChannel.onmessage = (event) => {
        let cmd = JSON.parse(event.data);
        console.log(cmd);
        inputProcess.send(cmd);
    };

    inputProcess.on('message', (response) => {
        console.log(`Message from input process: ${response}`);
        inputChannel.send(response);
    });

    inputChannel.onclose = () => {
        console.log('Input channel has been closed');
        inputProcess.kill();
    };

    inputProcess.on('error', (error) => {
        console.error('Input process error:', error);
    });
}

function handleVideoChannel(videoChannel) {
    videoChannel.onopen = () => {
        console.log("Video channel connected to peer");        
    };

    videoChannel.onclose = () => {
        console.log("Video channel has been closed");
        cleanup();
    };

    videoChannel.onerror = (error) => {
        console.error("Video channel error:", error);
    };
}

let v4l2Process = null;
const delayBeforeOpening = 0; 

function startStream() {
    if(isStartingStream) {
        return;
    }

    function startCameraStream() {
        console.log("starting camera");
        isStartingStream = true;

        setTimeout(() => {
            v4l2Process = spawn('v4l2-ctl', [
                '--stream-mmap',
                '--stream-to=-',
                '--device=/dev/video0',
                '--set-fmt-video=width=640,height=480,pixelformat=H264',
            ]);            

            v4l2Process.stdout.on('data', (chunk) => {
          
                if (isStreamToSpawn) {
                  if (videoChannel && videoChannel.readyState === "open") {
                    try {
                        videoChannel.send(chunk);
                      } catch (error) {
                        console.error('Error sending to Data Channel:', error);
                      }
                  }
                }
            });

            v4l2Process.on('exit', (code) => {
                //console.log(`v4l2-ctl process exited with code ${code}`);
                //cleanup();
            });

            v4l2Process.stderr.on('data', (error) => {
                //console.error(`Error from v4l2-ctl: ${error}`);
            });

        }, delayBeforeOpening);
    }
    startCameraStream(); 
}

function deletelive() {
    send({
        type: "updatelive",
        username: username
    });
}

function startImageCapture(interval) {
    if(intervalIds) {
        stopImageCapture();
    }
    const intervalId = setInterval(() => {
      captureImage(); 
    }, interval);
    intervalIds.push(intervalId);
    //console.log(`Started image capture interval #${intervalIds.length - 1}`);
}

function stopImageCapture() {
    while (intervalIds.length > 0) {
       clearInterval(intervalIds.pop());
       deletelive();
    }
    //console.log("All image captures terminated.");
}

const EventEmitter = require('events');
const messageEmitter = new EventEmitter();

function sendPW(message) {
    return new Promise((resolve, reject) => {
      signalingSocket.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
        }
      });
  
      messageEmitter.once('authbotpw', (response) => {
        try {
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });
}

function checkUserTokenBalance(message) {
    return new Promise((resolve, reject) => {
      signalingSocket.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
        }
      });
  
      messageEmitter.once('balanceChecked', (response) => {
        try {
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });
}

async function watchStream(name, pw) {
    if (!allowAllUsers && !allowedUsers.includes(name)) {
        return;
    }
    if (isPrivate) {
        if (pw) {
            try {
                const isValid = await verifyPassword(pw);
                if (isValid) {
                    if(tokenrate > 0) {
                        const isBalanceAvailable = await checkTokenBalance(name);
                        if(isBalanceAvailable) {
                            iceAndOffer(name);
                        } else{
                            console.log("User attempted to connect with valid password, but their balance was too low");
                        }
                    } else {
                        iceAndOffer(name);
                    }
                } else {
                    console.log("Password not authenticated");
                }
            } catch (error) {
                console.log("Error verifying password:", error);
            }
        } else {
            console.log("No bot password detected");
            return;
        }
    } else {
        iceAndOffer(name);
    }
}

function checkTokenBalance(name) {
    return new Promise((resolve, reject) => {
        checkUserTokenBalance({
            type: "checkTokenBalance",
            username: name,
            tokenrate: tokenrate
        }).then(response => {
            if (response.success) {
                resolve(true);
            } else {
                reject(new Error("Balance check failed"));
            }
        }).catch(error => {
            reject(error);
        });
    });
}

function verifyPassword(pw) {
    return new Promise((resolve, reject) => {
        if(handleSecretCodeAuth) {
            authenticateCode(pw).then(response => {
                if(response.success) {
                    resolve(true);
                } else {
                    reject(new Error("Secret code verification failed"));
                }
            }).catch(error => {
                reject(error);
            });
        } else {
            sendPW({
                type: "checkPassword",
                username: username,
                password: pw
            }).then(response => {
                if (response.success) {
                    resolve(true);
                } else {
                    reject(new Error("Password verification failed"));
                }
            }).catch(error => {
                reject(error);
            });
        }
    });
}

async function authenticateCode(pw) {
    try {
        if (pw === secretCode) {
            return { success: true };
        } else {
            return { success: false };
        }
    } catch (error) {
        console.log("Failed to authenticate password:", error);
        return { success: false };
    }
}

async function iceAndOffer(name) {
    if (peerConnection) {
        const iceState = peerConnection.iceConnectionState;
        if (iceState === "connected" || iceState === "completed") {
            return;
        } else {
            try {
                connectedUser = name;
                stopImageCapture();
                isStreamToSpawn = true;
                await createOffer();
                console.log("Offer created and sent");
            } catch (error) {
                console.error("Error during watchStream:", error);
            }
        }
    } else {
        console.log("Peer connection is not initialized.");
    }
}

function createOffer() {
    return new Promise((resolve, reject) => {
        peerConnection.createOffer()
            .then(offer => {
                return peerConnection.setLocalDescription(offer)
                .then(() => offer);
             })
            .then(offer => {               
                send({
                   type: "offer",
                   offer: offer,
                   username: username,
                   host: connectedUser
                });
                resolve();
            })
            .catch(err => reject(err));
    });
 }

async function captureImage() {
    try {
        send({
            type: "storeimg",
            image: profilePicture,
            username: username,
            tokenrate: tokenrate,
            location: location,
            description: description,
            botdevicetype: botdevicetype,
            private: isPrivate
        });
       // console.log("Sent image to server");        
    } catch (error) {
        console.log("Failed to process and send image to server", error);
    }
}

function endScript() {
    console.log("Peer connection closed. Exiting script...");
    gpioPins.forEach(pin => {
        pipins.writePinValue(pin, 0);
        console.log(`GPIO pin ${pin} turned OFF before exit`);
        pipins.unexportPin(pin);
        console.log(`GPIO pin ${pin} unexported on exit`);
    });
    pwmChannels.forEach(pin => {
        pipins.unexportPwm(pin);
        console.log(`PWM channel unexported on exit`);
    });
    process.exit(0);
}

function cleanup() {
    console.log("Cleaning up...");
    endScript();
}

(async () => {
    await startWebRTC();
})();

