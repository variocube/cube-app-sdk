import {connect} from "../src";

// Connect to the cube
const cube = await connect();

// Add listener for code events
cube.addEventListener("code", async ({code}) => {
    console.log(`Code was entered: ${code}`);

    // Open box 1 on correct code
    if (code == "12345") {
        await cube.openCompartment("1");
    }
});
