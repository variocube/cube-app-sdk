# cube-app-sdk

SDK for developing apps that run on Variocube lockers.

## What is a cube app?

A cube app is a web application that runs in a browser on a Variocube locker and uses its features.

The web application must be hosted on a public URL (like https://yourapp.com/variocube).

It may use Web APIs to provide offline functionality. Specifically, the following APIs are supported on Variocubes:

- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)

It can access the hardware features of the locker it runs on, like opening locks or receiving codes
from a QR-code reader.

Check out our [⭐⭐⭐ Demo App ⭐⭐⭐](https://variocube.github.io/cube-app-sdk/) for a quick overview of what is possible.

## How does it work?

When running on a Variocube, your web application will be able to communicate with a local service,
the `cube-app-service`, which provides access to the hardware features on the locker. This SDK encapsulates
the communication with this service and provides a simple API for interacting with the locker.

## Using the SDK

Add the package `@variocube/cube-app-sdk` to your web application and use it to interface with the Variocube locker.

If you are using React in your app, we advise using the `@variocube/cube-app-react-sdk` instead. It is a simple
React wrapper (context provider + hooks) around the SDK.

```shell
npm install @variocube/cube-app-sdk

# Or, in a React app:
npm install @variocube/cube-app-react-sdk
```

During development, you will need to use the virtual cube provided by the SDK. You can start it with:

```shell
npx @variocube/cube-app-service
```

The virtual cube will be available at [http://localhost:4000/](http://localhost:4000/).

You might want to take a look at the [source code of the demo app](packages/cube-app-demo) that is included in this repository.

### Connecting to the Variocube locker

A single call to the `connect` function provides access to all platform features:

```typescript
import {connect} from "@variocube/cube-app-sdk";

// Connect to the cube
const cube = connect();
```

### Opening a compartment

```typescript
await cube.openCompartment("1");
```

### Receiving code events

```typescript
// Add a listener for code events
cube.addEventListener("code", async ({code}) => {
	// Open box 1 on the correct code
	if (code == "12345") {
		await cube.openCompartment("1");
	}
});
```

### Receiving lock events

```typescript
// Add a listener for code events
cube.addEventListener("lock", async ({compartmentNumber, status}) => {
	console.log(`Compartment ${compartmentNumber} is now ${status}`);
});
```

### Retrieving compartments

```typescript
// Retrieve compartments of the cube
const compartments = cube.compartments;
for (const compartment of compartments) {
	await cube.openCompartment(compartment.number);
}
```

### Retrieving devices

```typescript
const devices = cube.devices;
for (const device of devices) {
	console.log(`Device ${device.id} is a ${device.types.join(", ")}`);
}
```

### Restarting

```typescript
// Restart the operating system
await cube.restartOperatingSystem();

// Restart the user interface
await cube.restartUserInterface();
```

## Handling error conditions

### No connection to cube app service

In case the cube app service is not available or the connection is lost, you cannot use any data or commands.

```typescript
// You can check the `connected` property
if (!cube.conntected) {
	console.error("Not connected to cube app service.");
}
// You can attach an event listener to get notified when the connection is lost
cube.addEventListener("close", () => console.error("Connection to cube app service lost."));
```

### No compartments

If a cube does not have compartments, it is either unconfigured, or the connection to the service that is managing compartments
could not be established or was lost.

```typescript
// You can check the length `connected` property
if (cube.compartments.length == 0) {
	console.error("No compartments.");
}
// You can attach an event listener to get notified when the compartments change
cube.addEventListener("compartments", ({compartments}) => {
	if (compartments.length == 0) {
		console.error("There are no longer any compartments.");
	}
});
```

### Device not available

If an attached device stops working, it is removed from the list of devices. You can check whether a device
that is necessary for your application is present:

```typescript
// Find a specific device in the list of devices
const reader = cube.devices.find(device => device.types.includes("BarcodeReader"));
if (!reader) {
	console.error("No reader present.");
}
// Attach an event to get notified when the devices change
cube.addEventListener("devices", ({devices}) => {
	const reader = devices.find(device => device.types.includes("BarcodeReader"));
	if (!reader) {
		console.error("Reader no longer present.");
	}
});
```

### Lock status `BLOCKED`

If a lock does not open, even though an open command was sent to it, it can be marked as `BLOCKED`. This typically happens
when the compartment door is mechanically blocked from opening.

```typescript
// Handle the `BLOCKED` status in a lock event handler
cube.addEventListener("lock", ({lock, status}) => {
	if (status == "BLOCKED") {
		console.error(`Lock ${lock} is blocked. Are you leaning against the door?`);
	}
});
```

### Lock status `BREAKIN`

If a lock is opened without a prior open command, it can be marked as `BREAKIN`.

```typescript
// Handle the `BLOCKED` status in a lock event handler
cube.addEventListener("lock", ({lock, status}) => {
	if (status == "BREAKIN") {
		console.error(`Break-in alert at lock ${lock}!`);
	}
});
```

## Limitations

When using this SDK and the underlying services, the following limitations apply compared to other Variocube applications.

### Single app only

Only a single app is supported. It is not possible to run multiple apps on the Variocube locker
or use existing Variocube apps alongside your app. However, you can implement a variety of use-cases
within your app.

### Bring Your Own (Basic) Features

Basic Variocube features that are commonly used across Variocube apps, like maintenance of compartments, location code,
maintenance codes, or the settings menu, are not supported. Your app needs to implement all required features.
