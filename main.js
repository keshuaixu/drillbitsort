const serial = chrome.serial;

/* Interprets an ArrayBuffer as UTF-8 encoded string data. */
var ab2str = function(buf) {
  var bufView = new Uint8Array(buf);
  var encodedString = String.fromCharCode.apply(null, bufView);
  return decodeURIComponent(escape(encodedString));
};

/* Converts a string to UTF-8 encoding in a Uint8Array; returns the array buffer. */
var str2ab = function(str) {
  var encodedString = unescape(encodeURIComponent(str));
  var bytes = new Uint8Array(encodedString.length);
  for (var i = 0; i < encodedString.length; ++i) {
    bytes[i] = encodedString.charCodeAt(i);
  }
  return bytes.buffer;
};

////////////////////////////////////////////////////////
////////////////////////////////////////////////////////

var SerialConnection = function() {
  this.connectionId = -1;
  this.lineBuffer = "";
  this.boundOnReceive = this.onReceive.bind(this);
  this.boundOnReceiveError = this.onReceiveError.bind(this);
  this.onConnect = new chrome.Event();
  this.onReadLine = new chrome.Event();
  this.onError = new chrome.Event();
};

SerialConnection.prototype.onConnectComplete = function(connectionInfo) {
  console.log(connectionInfo);
  if (!connectionInfo) {
    log("Connection failed.");
    return;
  }
  this.connectionId = connectionInfo.connectionId;
  chrome.serial.onReceive.addListener(this.boundOnReceive);
  chrome.serial.onReceiveError.addListener(this.boundOnReceiveError);
  this.onConnect.dispatch();
};

SerialConnection.prototype.onReceive = function(receiveInfo) {
  if (receiveInfo.connectionId !== this.connectionId) {
    return;
  }

  this.lineBuffer += ab2str(receiveInfo.data);

  var index;
  while ((index = this.lineBuffer.indexOf('\n')) >= 0) {
    var line = this.lineBuffer.substr(0, index + 1);
    this.onReadLine.dispatch(line);
    this.lineBuffer = this.lineBuffer.substr(index + 1);
  }
};

SerialConnection.prototype.onReceiveError = function(errorInfo) {
  if (errorInfo.connectionId === this.connectionId) {
    this.onError.dispatch(errorInfo.error);
  }
};

SerialConnection.prototype.connect = function(path, options) {
  serial.connect(path, options, this.onConnectComplete.bind(this))
};

SerialConnection.prototype.send = function(msg) {
  if (this.connectionId < 0) {
    throw 'Invalid connection';
  }
  serial.send(this.connectionId, str2ab(msg), function() {});
};

SerialConnection.prototype.disconnect = function() {
  if (this.connectionId < 0) {
    throw 'Invalid connection';
  }
  serial.disconnect(this.connectionId, function() {});
};

if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

////////////////////////////////////////////////////////

var zero_offset = 0;

var drill_bit_lut;
var drill_bit_lut_keys_int;

$.getJSON('inchdrill.json', function(data) {         
  drill_bit_lut = {};
  drill_bit_lut_keys_int = [];
  $.each( data, function( key, val ) {
    drill_bit_lut[val.reading] = val.name;
    drill_bit_lut_keys_int.push(parseInt(val.reading));
  });
});

var getClosestValue = function(counts,goal){
  var closest = counts.reduce(function (prev, curr) {
    return (Math.abs(curr - goal) < Math.abs(prev - goal) ? curr : prev);
  });
  return closest;
}

$("#zero-button").click(function(){
  zero_offset = parseInt($('#zero-input').val()*100) - current_reading;
  console.log(zero_offset);
});



////////////////////////////////////////////////////////

$( document ).ready(function() {
    console.log( "ready!" );
    chrome.serial.getDevices(function(devices) {
      buildPortPicker(devices,caliper_conn, "port-picker-caliper",  {bitrate: 115200});
      buildPortPicker(devices,robot_conn, "port-picker-robot",  {bitrate: 38400});
//       $('#cup-map').stickyTableHeaders();
    });   
});

var caliper_conn = new SerialConnection();
var robot_conn = new SerialConnection();

var current_reading;
var d_reading;
var current_drill_bit_size;

caliper_conn.onReadLine.addListener(function(line) {
  var last_reading = current_reading;
  current_reading = parseInt(line) + zero_offset; 
  d_reading = current_reading - last_reading;
  $('#caliper-reading').text((current_reading / 100.0).toFixed(2));
  // $('#caliper-reading').effect("highlight", {}, 100);

  var closestSize = getClosestValue(drill_bit_lut_keys_int, current_reading);
  var closestName = drill_bit_lut[closestSize];
  current_drill_bit_size = closestName
  
  $('#current-drill-bit-size').text(closestName);
  
});

//////////////////////////////////////////////////////

var cups = {};
var cupCount = 0;

var updateCupTable = function(size){
  if (size in cups) {
    // do nothing
  } else {
    var table = document.getElementById("cup-map");
    var myrow = table.insertRow(-1);
    cupCount += 1;
    myrow.insertCell(-1).innerHTML = cupCount;
    myrow.insertCell(-1).innerHTML = size;
    cups[size] = [cupCount, $('#cup-map tr:last')];
  }

  cups[size][1].effect("highlight", {}, 6000);
  return cups[size][0];
}

var capture = function(){
  $('#current-drill-bit-size').effect("highlight", {}, 400);
  return updateCupTable(current_drill_bit_size);
}

$("#clear-button").click(function(){
  cups = {};
  cupCount = 0;
  $("#cup-map").find("tr:gt(0)").remove();
});


///////////////////////////////////////////////////////

robot_conn.onReadLine.addListener(function(line) {
  console.log(line);
  if (line.trim() === "%m"){
    
    waitfor(function(){return Math.abs(d_reading) > 2}, false, 100, 0, 20, function(){
          var cup = capture();
          var command = "%{0}\n".format(pad(cup,2));
          robot_conn.send(command);      
    });

  }
});


function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function waitfor(test, expectedValue, msec, count, maxcount, callback) {
    // Check if condition met. If not, re-check later (msec).
    while (test() !== expectedValue) {
        count++;
        if (count > maxcount){
          break;
        }
        setTimeout(function() {
            waitfor(test, expectedValue, msec, count, maxcount, callback);
        }, msec);
        return;
    }
    callback();
}

////////////////////////////////////////////////////////
/*
var connection = new SerialConnection();

connection.onConnect.addListener(function() {
  log('connected to: ' + DEVICE_PATH);
  connection.send("hello arduino");
});

connection.onReadLine.addListener(function(line) {
  log('read line: ' + line);
});

connection.connect(DEVICE_PATH);

function log(msg) {
  var buffer = document.querySelector('#buffer');
  buffer.innerHTML += msg + '<br/>';
}

var is_on = false;
document.querySelector('button').addEventListener('click', function() {
  is_on = !is_on;
  connection.send(is_on ? 'y' : 'n');
});

*/
///////////////////////////////////////////////////////
///////////////////////////////////////////////////////
function buildPortPicker(ports,conn, port_picker, options) {
  var eligiblePorts = ports

  var portPicker = document.getElementById(port_picker);
  eligiblePorts.forEach(function(port) {
    var portButton = document.createElement('button');
    portButton.setAttribute('type','button');
    portButton.setAttribute('class','btn btn-default');
    portButton.value = portButton.innerText = port.path;
    portButton.onclick = function() {
      conn.connect(port.path,options)
      portButton.setAttribute('class','btn btn-success');
      $('#{0} button'.format(port_picker)).attr('disabled','disabled');
    };

    portPicker.appendChild(portButton);
  });


}
