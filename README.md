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

Check out our [⭐⭐⭐ Demo App ⭐⭐⭐](https://variocube.github.io/cube-app-sdk/) for a quick overview of
what is possible.

## How does it work?

When running on a Variocube, your web application will be able to communicate with a local service,
the `cube-app-service`, which provides access to the hardware features on the locker.

## Limitations

When using this SDK and the underlying services, the following limitations apply.

### Single app only

Only a single app is supported. It is not possible to run multiple apps on the Variocube locker
or use existing Variocube apps alongside your app.

### Variocube features

Variocube features like maintenance of compartments, location code, maintenance codes, or settings menu are not supported.
The cube app must provide such features by itself.

## Using the SDK

Add the package `@variocube/cube-app-sdk` to your web application and use it to interface with the Variocube locker.

```shell
npm install @variocube/cube-app-sdk
```

During development, you will need to use the virtual cube provided by the SDK. You can start it with:

```shell
npx @variocube/cube-app-service
```

The virtual cube will be available at [https://localhost:5000/](https://localhost:5000/).

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
