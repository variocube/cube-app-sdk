import {connect} from "@variocube/cube-app-sdk";

// Connect to the cube
const cube = connect();

// Add a listener for code events
cube.addEventListener("code", async ({code}) => {
    console.log(`Code was entered: ${code}`);

    // Open box 1 on the correct code
    if (code == "12345") {
        await cube.openCompartment("1");
    }
});
