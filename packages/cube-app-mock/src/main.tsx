import React, {StrictMode, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import "./main.css";
import {VcmpClient} from "@variocube/vcmp";
import {Compartment, CompartmentsMessage, LockMessage, OpenLockMessage, RestartMessage} from "@variocube/cube-app-sdk";

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)

const compartments: Compartment[] = new Array(16).fill(0)
    .map((_, index) => index + 1)
    .map((ordinal) => ({
        number: ordinal.toString(),
        lock: {
            id: "mock" + ordinal.toString().padStart(2, '0'),
            status: "CLOSED",
        },
        types: ["Default"],
        enabled: true,
        features: [],
    }));

function getCompartmentByLock(lock: string) {
    return compartments.find(box => box.lock.id === lock);
}

function App() {

    const [openLocks, setOpenLocks] = useState<string[]>([]);
    const [restarting, setRestarting] = useState(false);

    const client = useMemo(() => {
        const client = new VcmpClient("ws://localhost:5000/mock", {
            autoStart: true,
        });
        client.on<OpenLockMessage>("openLock", async ({lockId}) => {
            const compartment = getCompartmentByLock(lockId)
            if (!compartment) {
                throw new Error(`Box not found for lock ${lockId}`);
            }
            await handleOpen(compartment);
        });
        client.on<RestartMessage>("restart", () => {
            setRestarting(true);
            setTimeout(() => {
                setRestarting(false);
            }, 5000);
        });
        client.onOpen = async () => {
            await client.send<CompartmentsMessage>({
                "@type": "compartments",
                compartments
            });
        }
        return client;
    }, []);

    async function handleOpen(compartment: Compartment) {
        if (!openLocks.includes(compartment.lock.id)) {
            setOpenLocks(openLocks => [...openLocks, compartment.lock.id]);
            compartment.lock.status = "OPEN";
            await client.send<LockMessage>({
                "@type": "lock",
                lockId: compartment.lock.id,
                compartmentNumber: compartment.number,
                status: "OPEN",
            });
        }
    }

    async function handleClose(compartment: Compartment) {
        if (openLocks.includes(compartment.lock.id)) {
            setOpenLocks(openLocks => openLocks.filter(lock => lock !== compartment.lock.id));
            compartment.lock.status = "CLOSED";
            await client.send<LockMessage>({
                "@type": "lock",
                lockId: compartment.lock.id,
                compartmentNumber: compartment.number,
                status: "CLOSED",
            });
        }
    }

    const handleCompartmentClick = async (compartment: Compartment) => {
        if (openLocks.includes(compartment.lock.id)) {
            await handleClose(compartment);
        } else {
            await handleOpen(compartment);
        }
    };

    return (
        <div className="cube">
            <div className="banner border">
                VARIOCUBE
            </div>
            <div className="boxes">
                {compartments.map(compartment => (
                    <CompartmentItem
                        key={compartment.number}
                        compartment={compartment}
                        open={openLocks.includes(compartment.lock.id)}
                        onClick={handleCompartmentClick}
                    />
                ))}
            </div>
            {restarting && <div className="restarting">Restarting...</div>}
        </div>
    );
}

type CompartmentItemProps = {
    compartment: Compartment;
    open: boolean;
    onClick: (box: Compartment) => void;
}

function CompartmentItem({compartment, open, onClick}: Readonly<CompartmentItemProps>) {
    return (
        <div className={`box ${open && "open"}`}>
            <button className={"door border"} onClick={() => onClick(compartment)}>
                <div>{compartment.number}</div>
            </button>
        </div>
    )
}

