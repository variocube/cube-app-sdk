import React, {StrictMode, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import "./main.css";
import {
	CodeMessage,
	Compartment,
	CompartmentsMessage,
	Device,
	DevicesMessage,
	LockMessage,
	OpenLockMessage,
	RestartOsMessage,
	RestartUiMessage,
} from "@variocube/cube-app-sdk";
import {VcmpClient} from "@variocube/vcmp";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

const compartments: Compartment[] = new Array(16).fill(0)
	.map((_, index) => index + 1)
	.map((ordinal) => ({
		number: ordinal.toString(),
		lock: "mock" + ordinal.toString().padStart(2, "0"),
		types: ["Default"],
		enabled: true,
		features: [],
	}));

const devices: Device[] = [
	{
		id: "mock-locking",
		types: ["Locking"],
		vendor: "Variocube Gmbh",
		model: "Cube App Mock Locking",
		serialNumber: "VC-MOCK-LOCKING-V1",
		info: {numberOfLocks: compartments.length},
	},
	{
		id: "mock-scanner",
		types: ["BarcodeReader", "Keypad", "NfcReader"],
		vendor: "Variocube Gmbh",
		model: "Cube App Mock Scanner",
		serialNumber: "VC-MOCK-SCANNER-V1",
		info: null,
	},
];

function getCompartmentByLock(lock: string) {
	return compartments.find(compartment => compartment.lock === lock);
}

function App() {
	const [openLocks, setOpenLocks] = useState<string[]>([]);
	const [code, setCode] = useState("");
	const [restarting, setRestarting] = useState<string>();

	const client = useMemo(() => {
		const client = new VcmpClient(`ws://${location.host}/mock`, {
			autoStart: true,
		});
		client.on<OpenLockMessage>("openLock", async ({lock}) => {
			const compartment = getCompartmentByLock(lock);
			if (!compartment) {
				throw new Error(`Box not found for lock ${lock}`);
			}
			await handleOpen(compartment);
		});
		client.on<RestartOsMessage>("restartOs", () => {
			setRestarting("Restarting Operating System...");
			setTimeout(() => {
				setRestarting(undefined);
			}, 5000);
		});
		client.on<RestartUiMessage>("restartUi", () => {
			setRestarting("Restarting User Interface...");
			setTimeout(() => {
				setRestarting(undefined);
			}, 5000);
		});
		client.onOpen = async () => {
			await client.send<CompartmentsMessage>({
				"@type": "compartments",
				compartments,
			});
			await client.send<DevicesMessage>({
				"@type": "devices",
				devices,
			});
			for (const compartment of compartments) {
				if (compartment.lock) {
					await client.send<LockMessage>({
						"@type": "lock",
						lock: compartment.lock,
						compartmentNumber: compartment.number,
						status: "CLOSED",
					});
				}
			}
		};
		return client;
	}, []);

	async function handleOpen(compartment: Compartment) {
		const {lock, number} = compartment;
		if (lock && !openLocks.includes(lock)) {
			setOpenLocks(openLocks => [...openLocks, lock]);
			await client.send<LockMessage>({
				"@type": "lock",
				lock: lock,
				compartmentNumber: number,
				status: "OPEN",
			});
		}
	}

	async function handleClose(compartment: Compartment) {
		const {lock, number} = compartment;
		if (lock && openLocks.includes(lock)) {
			setOpenLocks(openLocks => openLocks.filter(openLock => openLock !== lock));
			await client.send<LockMessage>({
				"@type": "lock",
				lock: lock,
				compartmentNumber: number,
				status: "CLOSED",
			});
		}
	}

	const handleCompartmentClick = async (compartment: Compartment) => {
		if (compartment.lock && openLocks.includes(compartment.lock)) {
			await handleClose(compartment);
		}
		else {
			await handleOpen(compartment);
		}
	};

	async function handleCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await client.send<CodeMessage>({
			"@type": "code",
			code,
			source: "SCANNER",
		});
		setCode("");
	}

	return (
		<div className="cube">
			<div className="banner border coating">
				VARIOCUBE
			</div>
			<div className="scanner">
				<form onSubmit={handleCodeSubmit}>
					<label htmlFor="#code">Code (Barcode, QR-Code, NFC-Token, Keypad)</label>
					<div>
						<input
							id="code"
							placeholder="Enter code to scan"
							value={code}
							onChange={e => setCode(e.target.value)}
						/>
						<button type="submit">Submit Code</button>
					</div>
				</form>
			</div>
			<div className="boxes">
				{compartments.map(compartment => (
					<CompartmentItem
						key={compartment.number}
						compartment={compartment}
						open={Boolean(compartment.lock && openLocks.includes(compartment.lock))}
						onClick={handleCompartmentClick}
					/>
				))}
			</div>
			{restarting && <div className="restarting">{restarting}</div>}
		</div>
	);
}

type CompartmentItemProps = {
	compartment: Compartment;
	open: boolean;
	onClick: (box: Compartment) => void;
};

function CompartmentItem({compartment, open, onClick}: Readonly<CompartmentItemProps>) {
	return (
		<div className={`box ${open && "open"}`}>
			<button className={"door border coating"} onClick={() => onClick(compartment)}>
				<div>{compartment.number}</div>
			</button>
		</div>
	);
}
