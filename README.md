# cube-app-sdk

SDK for apps running on Variocube lockers.

> [!WARNING]
> This SDK is currently is DRAFT status. The interfaces defined in this repository are subject to change at any time.

> [!WARNING]
> Currently, there is no implementation of the SDK. Please contact Variocube, if you are interested in an integration
> based on this SDK.

## What is a cube app?

A cube app is a web application that runs in a browser on a Variocube locker and uses its features.

The web application must be hosted on a public URL (like https://yourapp.com/variocube).

It may use Web APIs to provide offline functionality. Specifically, the following APIs are supported on Variocubes:
 - [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
 - [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)

## How does it work?

When loading your web application on a Variocube locker, certain query parameters are appended to the URL
that lets the SDK know where exactly to connect to.

The communication with the locker is facilitated through REST (data) and Websockets (events). This SDK completely
encapsulates the communication and provides a simple JS/TS interface.

## Limitations

When using this SDK and the underlying services, the following limitations apply.

### Single app only

Only a single app is supported. It is not possible to run multiple apps on the Variocube locker,
or use existing Variocube apps alongside your app.

### Variocube features

Variocube features like maintenance of compartments, location code, maintenance codes, or settings menu are not supported.
Such features must be provided by the cube app. 

## Using the SDK

Add the package `@variocube/cube-app-sdk` to your web application and use it to interface with the Variocube locker.

A single call to the `connect` function provides access to all platform features:

```typescript
import {connect} from "@variocube/cube-app-sdk";

const cube = connect();
```

### Opening a compartment



### Retrieving a code event

