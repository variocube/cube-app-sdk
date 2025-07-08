import {createRoot} from "react-dom/client";
import React, {StrictMode} from "react";
import {connect} from "@variocube/cube-app-sdk";

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

const cube = connect();
cube.addEventListener("lock", ({lockId, compartmentNumber, status}) => console.log(`Lock ${lockId} of compartment ${compartmentNumber} is now ${status}`));

function App() {

    function openFirstCompartment() {
        const first = cube.getCompartments().shift();
        if (first) {
            cube.openCompartment(first.number);
        }
    }

    return (
        <div>
            <h1>Hello World!</h1>
            <div>
                <button onClick={() => cube.restart()}>
                    Restart
                </button>
                <button onClick={openFirstCompartment}>
                    Open First Compartment
                </button>
            </div>

        </div>

    )
}