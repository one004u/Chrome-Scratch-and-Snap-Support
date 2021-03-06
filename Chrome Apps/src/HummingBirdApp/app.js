(function () {

    function openSnap() {
        //startHTTP();
        chrome.browser.openTab({
            url: 'http://snap.berkeley.edu/snapsource/snap.html#cloud:Username=birdbraintech&ProjectName=Hummingbird-Chrome100'
        });
    }

    function openScratch() {
        chrome.browser.openTab({
            url: 'http://scratchx.org/?url=http://birdbraintechnologies.github.io/Chrome-Scratch-and-Snap-Support/Scratch%20Plugins/HummingbirdHID_Scratch(Chrome%20Plugin)/v1.0.js#scratch'
        });
    }

    function openHowToHBMode() {
        chrome.browser.openTab({
            url: 'http://hummingbirdkit.com/learning/switching-arduino-mode-hummingbird-mode'
        });
    }

    var ui = {
        connected: null,
        disconnected: null,
        arduino: null,
        uno: null,
        bluetooth: null
    };
    var isDisconnectedInArduinoMode = false;
    var connection = -1;
    var deviceMap = {};

    //bluetoothStuff
    var isBluetoothConnection = false;
    var pairedBLEDevice = null;
    var rxID, txID;
    var BLEServiceUUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();
    var BLEServiceUUIDTX = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();//sending
    var BLEServiceUUIDRX = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();//receiving

    //raw sensor info from hummingbird
    var sensor_nums = new Array(4);
    var platform;

    //creates the initial window for the app, adds listeners for when a connection
    //is made, and looks for the hummingbird
    var initializeWindow = function () {
        for (var k in ui) {
            var id = k.replace(/([A-Z])/, '-$1').toLowerCase();
            var element = document.getElementById(id);
            if (!element) {
                throw "Missing UI element: " + k;
            }
            ui[k] = element;
        }

        enableIOControls(false);
        chrome.runtime.getPlatformInfo(function (platformInfo) {
            platform = platformInfo.os;
            console.log(platform);
            if (platform === 'cros') {
                enumerateBLEDevices();
            }
        });
        document.getElementById("snapButton").addEventListener('click', openSnap);
        document.getElementById("scratchButton").addEventListener('click', openScratch);
        chrome.runtime.onMessageExternal.addListener(onMsgRecv);
        chrome.runtime.onConnectExternal.addListener(onConnect);
        enumerateDevices();
    };

    var isDuo = true;

    function clearQueue() {
        chrome.hid.receive(connection, function (num, data) {
            if (chrome.runtime.lastError) {
            }
        });
    }

    function getHummingbirdType(callback) {
        if (connection == -1) {
            return;
        }
        if (isBluetoothConnection) {
            isDuo = true;
            callback();
            return;
        }
        var bytes = new Uint8Array(8);
        bytes[0] = 'G'.charCodeAt(0);
        bytes[1] = '4'.charCodeAt(0);
        for (var i = 2; i < (bytes.length - 1); i++) {
            bytes[i] = 0;
        }
        bytes[7] = 'G'.charCodeAt(0);
        var id = 0;
        chrome.hid.send(connection, id, bytes.buffer, function () {
            if (chrome.runtime.lastError) {
                connection = -1;
                enableIOControls(false);
                callback();
                return;
            }
            setTimeout(function () {
                console.log("sent request for type");

                chrome.hid.receive(connection, function (num, data) {
                    if (chrome.runtime.lastError) {
                        connection = -1;
                        enableIOControls(false);
                        callback();
                        return;
                    }
                    var data_array = new Uint8Array(data);
                    if (data_array[7] !== 'G'.charCodeAt(0)) {
                        chrome.hid.receive(connection, function (num, data) {
                            if (chrome.runtime.lastError) {
                                connection = -1;
                                enableIOControls(false);
                                callback();
                                return;
                            }
                            var data_array = new Uint8Array(data);
                            if (data_array[0] === 0x03 && data_array[1] === 0x00) {
                                isDuo = true;
                            } else {
                                console.log("Uno, got response: ");
                                for (var k = 0; k < data_array.length; k++) {
                                    console.log(data_array[k]);
                                }
                                isDuo = false;
                            }
                            callback();
                        });
                    }
                    if (data_array[0] === 0x03 && data_array[1] === 0x00) {
                        isDuo = true;
                    } else {
                        console.log("Uno, got response: ");
                        for (var k = 0; k < data_array.length; k++) {
                            console.log(data_array[k]);
                        }
                        isDuo = false;
                    }
                    callback();
                });

            }, 100);
        });
    }

    function sendBytes(bytes) {
        var id = 0;
        if (isBluetoothConnection) {
            sendMessageBLE(bytes.buffer);
        } else {
            chrome.hid.send(connection, id, bytes.buffer, function () {
                if (chrome.runtime.lastError) {
                    connection = -1;
                    enableIOControls(false);
                }
            });
        }
    }

    var hummingbirdPort;
    //when a connection is made to this app
    var onConnect = function (port) {
        hummingbirdPort = port;
        //if it disconnects
        port.onDisconnect.addListener(function () {
            hummingbirdPort = undefined;
        });
        // a listener for messages send via this connection
        //(when the client doesn't open a long
        //term port for communication)
        port.onMessage.addListener(function (request) {
            //the message is asking for tts
            if (request.message === "SPEAK") {
                chrome.tts.speak(request.val); //speak phrase using text to speech
            }
            else if (request.message === "MOTOR") {
                var bytes = Uint8Array.of(
                    'M'.charCodeAt(0),
                    request.port.toString().charCodeAt(0),
                    (request.velocity < 0 ? 1 : 0).toString().charCodeAt(),
                    Math.abs(request.velocity),
                    0, 0, 0, 0
                );

                sendBytes(bytes);
                port.postMessage({
                    motor: {
                        velocity: request.velocity,
                        port: request.port
                    }
                });
            }
            else if (request.message === "TRILED") {
                var bytes = Uint8Array.of(
                    'O'.charCodeAt(0),
                    request.port.toString().charCodeAt(0),
                    request.intensities[0],
                    request.intensities[1],
                    request.intensities[2],
                    0, 0, 0
                );

                sendBytes(bytes);
                port.postMessage({
                    triLED: {
                        intensities: request.intensities,
                        port: request.port
                    }
                });
            }
            else if (request.message === "LED") {
                var bytes = Uint8Array.of(
                    'L'.charCodeAt(0),
                    request.port.toString().charCodeAt(0),
                    request.intensity,
                    0, 0, 0, 0, 0
                );

                sendBytes(bytes);
                port.postMessage({
                    LED: {
                        intensity: request.intensity,
                        port: request.port
                    }
                });
            }
            else if (request.message === "SERVO") {
                var bytes = Uint8Array.of(
                    'S'.charCodeAt(0),
                    request.port.toString().charCodeAt(0),
                    request.angle,
                    0, 0, 0, 0, 0
                );

                sendBytes(bytes);
                port.postMessage({
                    servo: {
                        angle: request.angle,
                        port: request.port
                    }
                });
            }
            else if (request.message === "VIBRATION") {
                var bytes = Uint8Array.of(
                    'V'.charCodeAt(0),
                    request.port.toString().charCodeAt(0),
                    request.intensity,
                    0, 0, 0, 0, 0
                );

                sendBytes(bytes);
                port.postMessage({
                    vibration: {
                        intensity: request.intensity,
                        port: request.port
                    }
                });
            }
        });

    };
    //this is what is called when a message is sent directly to this app
    var onMsgRecv = function (request, sender, sendResponse) {
        //the message is asking for the status of the hummingbird (connected or disconnected)
        if (request.message === "STATUS") {
            if (connection === -1) //not connected
                sendResponse({status: false}); //send tatus to Scratch
            else {
                sendResponse({status: true, duo: isDuo});
            }
        }
        //the message is asking for sensor information
        else if (request.message === "POLL") {
            sendResponse({
                port1: sensor_nums[0],
                port2: sensor_nums[1],
                port3: sensor_nums[2],
                port4: sensor_nums[3]
            });
        }
        //the message is asking for tts
        else if (request.message === "SPEAK") {
            chrome.tts.speak(request.val); //speak phrase using text to speech
        }
        else { // setting things on Hummingbird, no return report
            var bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
            var counter = 0;
            for (var prop in request) { //read through request, adding each property to byte array
                if (request.hasOwnProperty(prop)) {
                    bytes[counter] = request[prop];
                    counter++;
                }
            }
            for (var i = counter; i < bytes.length; ++i) {
                bytes[i] = 0;
            }
            var id = 0;
            if (isBluetoothConnection) {
                sendMessageBLE(bytes.buffer, function(){});

            } else {
                chrome.hid.send(connection, id, bytes.buffer, function () {
                    if (chrome.runtime.lastError) {
                        connection = -1;
                        enableIOControls(false);
                    }
                });
            }
            // There is no data to send, but the caller may have a callback
            // to know when the message was processed.
            sendResponse();
        }
    };
    //this function sends requests to the hummingbird for all of its sensor data
    //this call is made 20 times a second and if it fails, it marks the
    //hummingbird as no longer connected
    var pollSensors = function () {
        console.log("polling sensors");
        var bytes = new Uint8Array(8);
        //all sensors
        bytes[0] = "G".charCodeAt(0);
        bytes[1] = "3".charCodeAt(0);
        for (var i = 2; i < bytes.length; ++i) {
            bytes[i] = 0;
        }
        var id = 0;

        if (connection === -1)
            return;
        chrome.hid.send(connection, id, bytes.buffer, function () {
            if (chrome.runtime.lastError) {
                connection = -1;
                enableIOControls(false);
                return;
            }
            setTimeout(function () {
                recvSensors();
                setTimeout(pollSensors, 50);
            }, 10);
        });
    };
    //this function reads reports send from the hummingbird 20 times a second
    //NOTE: The sensor data is still raw information and not converted to any
    //standard form. This is because the hummingbird can have many different
    //sensors and it is up to the user of this extension to convert the info
    //In the scratch and snap plugins created to be used with this extension,
    //the information is converted there
    var recvSensors = function () {
        chrome.hid.receive(connection, function (num, data) {
            if (chrome.runtime.lastError) {
                connection = -1;
                enableIOControls(false);
                return;
            }

            var data_array = new Uint8Array(data);
            for (var i = 0; i < 4; i++) { //retrieves and stores all sensor values
                sensor_nums[i] = data_array[i];
            }
            //calls the post message function in the javascript using this plugin
            //if a port has been opened. this allows for the user of this app
            //to keep track of the updated information
            if (hummingbirdPort !== undefined) {
                hummingbirdPort.postMessage({sensors: sensor_nums});
            }
        });
    };
    //controls the display of the app (showing if the hummingbird is connected or
    //disonnected)
    var enableIOControls = function (ioEnabled) {
        if (isDisconnectedInArduinoMode && ioEnabled === false) {//disconnected but arduino mode found
            ui.disconnected.style.display = 'none';
            ui.connected.style.display = 'none';
            ui.bluetooth.style.display = 'none';
            ui.arduino.style.display = 'inline';
        }
        else { //no arduino mode
            ui.arduino.style.display = 'none';
            ui.disconnected.style.display = ioEnabled ? 'none' : 'inline';

            if (isDuo && !isBluetoothConnection) { //device may be connected, if it is, its a duo
                ui.connected.style.display = ioEnabled ? 'inline' : 'none';
                ui.uno.style.display = 'none';
                ui.bluetooth.style.display = 'none';
            }
            else if (!isBluetoothConnection) { //device may be connected, if it is, its not a duo or a BLE
                ui.uno.style.display = ioEnabled ? 'inline' : 'none';
                ui.connected.style.display = 'none';
                ui.bluetooth.style.display = 'none';
            }
            else { //BLE
                ui.disconnected.style.display = 'none';
                ui.connected.style.display = 'none';
                ui.arduino.style.display = 'none';
                ui.bluetooth.style.display = ioEnabled ? 'inline' : 'none';
            }
        }
        /*
         if (!ioEnabled && httpRunning){
         leds = [-1,-1,-1,-1];
         trileds = [[-1,-1,-1],[-1,-1,-1]];
         vibrations = [-1,-1];
         motors = [-1,-1];
         servos = [-1,-1,-1,-1];
         }
         */
    };

    var recvSensorsBLE = function () {
        setTimeout(function () {
            console.log("got some sensor stuff");
            chrome.bluetoothLowEnergy.readCharacteristicValue(rxID.instanceId, function (characteristic) {
                //rxID = characteristic;
                var data_array = new Uint8Array(characteristic.value);

                for (var a = 0; a < data_array.length; a++){
                    console.log(data_array[a]);
                }

                for (var i = 0; i < 4; i++) { //retrieves and stores all sensor values
                    sensor_nums[i] = data_array[i];
                }
                //calls the post message function in the javascript using this plugin
                //if a port has been opened. this allows for the user of this app
                //to keep track of the updated information
                if (hummingbirdPort !== undefined) {
                    hummingbirdPort.postMessage(sensor_nums);
                }
            });
        }, 50);
        if (pairedBLEDevice !== null)
            setTimeout(recvSensorsBLE, 100);
    };

    var enumerateBLEDevices = function () {
        console.log("looking at BLE!\n");
        //first look at devices I know
        chrome.bluetooth.getAdapterState(function (adapterInfo) {
            if (adapterInfo.available && adapterInfo.powered) {
                chrome.bluetooth.getDevices(function (knownDevices) {
                    for (var i = 0; i < knownDevices.length; i++) {
                        var knownDevice = knownDevices[i];
                        if (knownDevice.uuids !== undefined) {
                            if (knownDevice.uuids.indexOf(BLEServiceUUID) > -1) {
                                if (knownDevice.paired) {
                                    pairedBLEDevice = knownDevice;
                                }
                            }
                        }
                    }
                    connectToBLE(function(){});
                });
            }
        });

    };

    var connectToBLE = function (callback) {
        if (pairedBLEDevice === null) {
            setTimeout(enumerateBLEDevices, 1000);
            return;
        }
        chrome.bluetoothLowEnergy.connect(pairedBLEDevice.address, function () {
            if (chrome.runtime.lastError) {
                console.log("Failed to connect");
                return;
            }
            //connected
            console.log("connected");
            chrome.bluetoothLowEnergy.getServices(pairedBLEDevice.address, function (services) {
                if (chrome.runtime.lastError) {
                    console.log("Failed to get Services: " + chrome.runtime.lastError.message);
                    return;
                }
                var serviceUART;
                for (var i = 0; i < services.length; i++) {
                    if (services[i].uuid === BLEServiceUUID) {
                        serviceUART = services[i];
                        break;
                    }
                }
                if (serviceUART === null) {
                    console.log("Couldn't find UART: " + chrome.runtime.lastError.message);
                    return;
                } else
                    console.log("UART");
                    chrome.bluetoothLowEnergy.getCharacteristics(serviceUART.instanceId, function (characteristics) {
                    if (chrome.runtime.lastError) {
                        console.log("Failed to get characteristics: " + chrome.runtime.lastError.message);
                        return;
                    }
                    txID = null;
                    rxID = null;
                    for (var i = 0; i < characteristics.length; i++) {
                        if (characteristics[i].uuid === BLEServiceUUIDRX) {
                            rxID = characteristics[i];
                        }
                        if (characteristics[i].uuid === BLEServiceUUIDTX) {
                            txID = characteristics[i];
                        }
                        if (txID !== null && rxID !== null) {
                            console.log("characteristics");
                            isBluetoothConnection = true;
                            connection = 1;
                            enableIOControls(true);
                            startPollBLE();
                            callback();
                        }
                    }
                });
            });
        });
    };

    var sendMessageBLE = function (arrayBuf, callback) {
        chrome.bluetoothLowEnergy.writeCharacteristicValue(txID.instanceId, arrayBuf, callback);
    };

    var startPollBLE = function () {
        console.log("starting BLE polling");
        var bytes = new Uint8Array(8);
        bytes[0] = 'G'.charCodeAt(0);
        bytes[1] = '6'.charCodeAt(0);
        for (var i = 2; i < bytes.length; i++) {
            bytes[i] = 0;
        }
        sendMessageBLE(bytes.buffer, function () {
            recvSensorsBLE();
        });
    };

    chrome.bluetooth.onDeviceRemoved.addListener(function (deviceRemoved) {
        if (deviceRemoved === pairedBLEDevice) {
            enableIOControls(false);
            isBluetoothConnection = false;
            connection = -1;
            pairedBLEDevice = null;
            txID = null;
            rxID = null;
            enumerateBLEDevices();
        }
    });

    //looks for devices
    var enumerateDevices = function () {
        console.log("looking at USB!\n");

        var deviceIds = [];
        var permissions = chrome.runtime.getManifest().permissions;
        for (var i = 0; i < permissions.length; ++i) {
            var p = permissions[i];
            if (p.hasOwnProperty('usbDevices')) {
                //the id of the hummingbird is obtained from the manifest file
                deviceIds = deviceIds.concat(p.usbDevices);
            }
        }
        if (connection === -1) {//to update between being disconnected or connected in arduino mode (which is still disconnected)
            enableIOControls(false);
        }
        chrome.usb.getDevices(deviceIds[1], foundArduinoMode);//arduino mode 

        //looks for hid device with vendor&product id specified in manifest
        chrome.hid.getDevices(deviceIds[0], onDevicesEnumerated);
    };

    //after devices have been found, the devices variable is an array of
    //HidDeviceInfo, after waiting a second it checks for devices again
    var onDevicesEnumerated = function (devices) {
        console.log("USB enumerated");
        for (var i = 0; i < devices.length; ++i) {
            //maps opaque device id to HidDeviceInfo
            deviceMap[devices[i].deviceId] = devices[i];
        }
        //maps opaque device id to HidDeviceInfo
        if (connection === -1) {
            console.log("connecting");
            connect();
        }
        setTimeout(enumerateDevices, 1000);
    };

    var popupOpen = false;
    var foundArduinoMode = function (devices) {
        if (devices.length > 0) {
            isDisconnectedInArduinoMode = true;
            if (popupOpen === false) {
                popupOpen = true;
                chrome.app.window.create("popup.html",
                    {innerBounds: {width: 300, height: 250, minWidth: 100}},
                    function (window) {
                    });
            }
        } else {
            isDisconnectedInArduinoMode = false;
        }

    };
    //records the connection, displays on app that the connection was made,
    //begins polling for information
    var connectFunction = function (connectInfo) {
        if (chrome.runtime.lastError || !connectInfo) {
            return;
        }
        connection = connectInfo.connectionId;
        setTimeout(function () {
            getHummingbirdType(function () {
                //so we have enough time for getHummingbirdType to finish
                setTimeout(function () {
                    enableIOControls(true);
                    pollSensors();
                }, 250);
            });
        }, 100);//timeout gives us time to actually connect before we ask for type
    };
    //connects to non-null devices in device map
    var connect = function () {
        for (var k in deviceMap) {
            var deviceInfo = deviceMap[k];
            if (!deviceInfo)
                return;
            //does the actual connecting
            chrome.hid.connect(deviceInfo.deviceId, connectFunction);
        }
    };


    //-----------------------------------------------------------------------------------------------------------------
    //http server stuff------------------------------------------------------------------------------------------------
    //-----------------------------------------------------------------------------------------------------------------
    //This code is for accepting http requests to control the hummingbird
    //while the above code is for javascript communications with this app
    //to control the hummingbird
    //-----------------------------------------------------------------------------------------------------------------
    /*
     var httpRunning = false;
     var tcpServer = chrome.sockets.tcpServer;
     var tcpSocket = chrome.sockets.tcp;

     var serverSocketId = null;
     var clientSocketId = null;
     //this internal representation is ONLY valid for HTTP comunications
     var leds = [-1,-1,-1,-1];
     var trileds = [[-1,-1,-1],[-1,-1,-1]];
     var vibrations = [-1,-1];
     var motors = [-1,-1];
     var servos = [-1,-1,-1,-1];

     function t2ab(str) {
     var buffer = new ArrayBuffer(str.length);
     var view = new DataView(buffer);
     for(var i = 0, l = str.length; i < l; i++) {
     view.setInt8(i, str.charAt(i).charCodeAt());
     }
     return buffer;
     }

     function ab2t(buffer) {
     var str = '';
     var uArrayVal = new Uint8Array(buffer);
     for (var s = 0; s < uArrayVal.length; s++) {
     str += String.fromCharCode(uArrayVal[s]);
     }
     return str;
     }


     var RESPHEAD = [
     "HTTP/1.1 200 OK",
     "Server: HummingbirdFinchServer",
     "Content-Length: {%len%}",
     "Connection: Close",
     "Content-Type: text/html",
     "Access-Control-Allow-Origin: *"
     ];
     RESPHEAD = RESPHEAD.join("\r\n")+"\r\n\r\n";

     var response = function(str){
     var len = str.length;
     return t2ab(RESPHEAD.replace("{%len%}", len)+str);
     };

     var destroySocketById = function(socketId) {
     tcpSocket.disconnect(socketId, function() {
     tcpSocket.close(socketId);
     });
     };
     function startHTTP(){
     httpRunning = true;
     tcpServer.create({},function(createInfo){
     listenAndAccept(createInfo.socketId);
     });
     }
     function stopHTTP(){
     tcpServer.close(serverSocketId, function(){});
     }
     function listenAndAccept(socketId) {
     tcpServer.listen(socketId,
     "127.0.0.1", 22179, function(resultCode) {
     onListenCallback(socketId, resultCode);
     });
     }
     function onListenCallback(socketId, resultCode) {
     console.log("listening...");
     if (resultCode < 0) {
     console.log("Error listening:" +
     chrome.runtime.lastError.message);
     return;
     }
     serverSocketId = socketId;
     tcpServer.onAccept.addListener(onAccept);
     tcpSocket.onReceive.addListener(onReceive);
     tcpServer.getInfo(serverSocketId, function(socketInfo){
     console.log("address: " + socketInfo.localAddress+"   port: "+socketInfo.localPort);
     });
     }
     function onAccept(info) {
     console.log("accepted connection");
     if (info.socketId != serverSocketId)
     return;
     // A new TCP connection has been established.
     clientSocketId = info.clientSocketId;


     //tcpSocket.send(clientSocketId, response(RESP),
     //function(resultCode) {
     //    console.log("Data sent to new TCP client connection.");
     //});
     // Start receiving data.
     tcpSocket.setPaused(info.clientSocketId, false);
     }

     var onReceive = function(receiveInfo) {
     console.log("READ", receiveInfo);
     var socketId = receiveInfo.socketId;

     // Parse the request.
     var data = ab2t(receiveInfo.data);
     // we can only deal with GET requests
     if (data.indexOf("GET ") !== 0) {
     // close socket and exit handler
     //destroySocketById(socketId);
     return;
     }
     var uriEnd = data.indexOf(" ", 4);
     if (uriEnd < 0) { return; }
     var uri = data.substring(4, uriEnd);
     // strip query string
     var q = uri.indexOf("?");
     if (q != -1) {
     uri = uri.substring(0, q);
     }
     processRequest(uri);
     //destroySocketById(socketId);
     };

     function processRequest(uri){
     var bytes, id = 0, i;
     var parts = uri.split("/");
     parts = parts.filter(function(n){return n !=="";});
     console.log(parts);
     if (parts.length < 3)
     return;
     if (parts[0] !== "hummingbird")
     return;
     if (parts[1] === "out"){
     if(parts.length < 5)
     return;
     var portString = (parseInt(parts[3]) - 1).toString();
     switch(parts[2]){
     case "motor":
     console.log("got motor command");
     var rawVelocity = parseInt(parts[4]);
     if (rawVelocity == motors[parseInt(portString)]){
     tcpSocket.send(clientSocketId, response("motor is already at that value"),
     function(resultCode) {
     console.log("motor has not been set");

     });
     return;
     }
     var velocity = rawVelocity;
     var direction;
     if (velocity < 0) {
     direction = "1".charCodeAt(0);
     velocity = Math.floor(velocity * -2.55);
     }
     else {
     direction = "0".charCodeAt(0);
     velocity = Math.floor(velocity * 2.55);
     }
     bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
     bytes[0] = "M".charCodeAt(0);
     bytes[1] = portString.charCodeAt(0);
     bytes[2] = direction;
     bytes[3] = velocity;
     for (i = 4; i < bytes.length; ++i) {
     bytes[i] = 0;
     }
     id = 0;
     chrome.hid.send(connection, id, bytes.buffer, function () {});
     tcpSocket.send(clientSocketId, response("set motor"),
     function(resultCode) {
     motors[parseInt(portString)] = rawVelocity;
     console.log("motor has been set");
     });
     break;
     case "servo":
     var angle = parseInt(parts[4]);
     if (angle == servos[parseInt(portString)]){
     tcpSocket.send(clientSocketId, response("servo is already at that value"),
     function(resultCode) {
     console.log("servo has not been set");
     });
     return;
     }
     var realAngle = Math.floor(angle * 2.35);
     bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
     bytes[0] = "S".charCodeAt(0);
     bytes[1] = portString.charCodeAt(0);
     bytes[2] = realAngle;
     for (i = 3; i < bytes.length; ++i) {
     bytes[i] = 0;
     }
     id = 0;
     chrome.hid.send(connection, id, bytes.buffer, function () {});
     tcpSocket.send(clientSocketId, response("set servo"),
     function(resultCode) {
     servos[parseInt(portString)] = angle;
     console.log("servo has been set");
     });
     break;
     case "vibration":
     var vibSpeed = parseInt(parts[4]);
     if (vibSpeed == vibrations[parseInt(portString)]){
     tcpSocket.send(clientSocketId, response("vibration is already at that value"),
     function(resultCode) {
     console.log("vibration has not been set");
     });
     return;
     }
     var realIntensity = Math.floor(vibSpeed * 2.55);
     bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
     bytes[0] = "V".charCodeAt(0);
     bytes[1] = portString.charCodeAt(0);
     bytes[2] = realIntensity;
     for (i = 3; i < bytes.length; ++i) {
     bytes[i] = 0;
     }
     id = 0;
     chrome.hid.send(connection, id, bytes.buffer, function () {});
     tcpSocket.send(clientSocketId, response("set vibration"),
     function(resultCode) {
     console.log("vibration has been set");
     vibrations[parseInt(portString)] = vibSpeed;
     });
     break;
     case "led":
     var intensity = parseInt(parts[4]);
     if (intensity == leds[parseInt(portString)]){
     tcpSocket.send(clientSocketId, response("led is already at that value"),
     function(resultCode) {
     console.log("led has not been set");
     });
     return;
     }
     var realIntensityLED = Math.floor(intensity * 2.55);
     bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
     bytes[0] = "L".charCodeAt(0);
     bytes[1] = portString.charCodeAt(0);
     bytes[2] = realIntensityLED;
     for (i = 3; i < bytes.length; ++i) {
     bytes[i] = 0;
     }
     id = 0;
     chrome.hid.send(connection, id, bytes.buffer, function () {});
     tcpSocket.send(clientSocketId, response("set led"),
     function(resultCode) {
     console.log("led has been set");
     leds[parseInt(portString)] = intensity;
     });
     break;
     case "triled":
     if(parts.length < 7)
     return;
     var red = parseInt(parts[4]);
     var green = parseInt(parts[5]);
     var blue = parseInt(parts[6]);
     if ([red, green, blue] == trileds[parseInt(portString)]){
     tcpSocket.send(clientSocketId, response("triled is already at that value"),
     function(resultCode) {
     console.log("triled has not been set");
     });
     return;
     }
     var realRed = Math.floor(red * 2.55);
     var realGreen = Math.floor(green * 2.55);
     var realBlue = Math.floor(blue * 2.55);
     bytes = new Uint8Array(8); //array of bytes to send to Hummingbird
     bytes[0] = "O".charCodeAt(0);
     bytes[1] = portString.charCodeAt(0);
     bytes[2] = realRed;
     bytes[3] = realGreen;
     bytes[4] = realBlue;
     for (i = 5; i < bytes.length; ++i) {
     bytes[i] = 0;
     }
     id = 0;
     chrome.hid.send(connection, id, bytes.buffer, function () {});
     tcpSocket.send(clientSocketId, response("set triled"),
     function(resultCode) {
     console.log("triled has been set");
     trileds[parseInt(portString)] = [red, green, blue];
     });
     break;
     }
     }
     else if (parts[1] === "in"){
     var responseString = "", port;
     switch(parts[2]){
     case "sensors":
     var port1 = Math.floor(sensor_nums[0] / 2.55);
     var port2 = Math.floor(sensor_nums[1] / 2.55);
     var port3 = Math.floor(sensor_nums[2] / 2.55);
     var port4 = Math.floor(sensor_nums[3] / 2.55);
     responseString =  port1.toString() + " " + port2.toString() + " "
     + port3.toString() + " " + port4.toString() + " ";
     id = 0;
     tcpSocket.send(clientSocketId, response(responseString),
     function(resultCode) {
     console.log("got sensors data");
     });
     break;
     case "sensor":
     if(parts.length < 4)
     return;
     port = parseInt(parts[3]) - 1;
     responseString =  Math.floor(sensor_nums[port] / 2.55).toString();
     id = 0;
     tcpSocket.send(clientSocketId, response(responseString),
     function(resultCode) {
     console.log("got sensor data");
     });
     break;
     case "distance":
     if(parts.length < 4)
     return;
     var finalAnswer;
     port = parseInt(parts[3]) - 1;
     var reading = sensor_nums[port] * 4;
     if (reading < 130) {
     finalAnswer = 100;
     }
     else { //formula based on mathematical regression
     reading = reading - 120;
     var distance;
     if (reading > 680)
     distance = 5.0;
     else {
     var sensor_val_square = reading * reading;
     distance = sensor_val_square * sensor_val_square * reading * -0.000000000004789
     + sensor_val_square * sensor_val_square * 0.000000010057143
     - sensor_val_square * reading * 0.000008279033021
     + sensor_val_square * 0.003416264518201
     - reading * 0.756893112198934
     + 90.707167605683000;
     }
     finalAnswer = parseInt(distance);
     }
     responseString =  finalAnswer.toString();
     id = 0;
     tcpSocket.send(clientSocketId, response(responseString),
     function(resultCode) {
     console.log("got distance data");
     });
     break;
     case "sound":
     if(parts.length < 4)
     return;
     port = parseInt(parts[3]) - 1;
     var soundLevel = sensor_nums[port];
     responseString =  soundLevel.toString();
     id = 0;
     tcpSocket.send(clientSocketId, response(responseString),
     function(resultCode) {
     console.log("got sound data");
     });
     break;
     case "temperature":
     if(parts.length < 4)
     return;
     port = parseInt(parts[3]) - 1;
     var temp = Math.floor(((sensor_nums[port] - 127) / 2.4 + 25) * 100 / 100);
     responseString =  temp.toString();
     id = 0;
     tcpSocket.send(clientSocketId, response(responseString),
     function(resultCode) {
     console.log("got temperature data");
     });
     break;
     }
     }
     }
     */
    window.addEventListener('load', initializeWindow);
}());
