import React, {StrictMode, useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import "./main.css";
import {
	CodeMessage,
	Compartment,
	CompartmentsMessage,
	Device,
	DevicesMessage,
	LockMessage,
	LockStatus,
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
	// Initialize the lock status with CLOSED
	const [lockStatus, setLockStatus] = useState<Record<string, LockStatus>>(() => {
		return compartments.reduce((acc: Record<string, LockStatus>, next) => {
			if (next.lock) {
				acc[next.lock] = "CLOSED";
			}
			return acc;
		}, {});
	});
	const [code, setCode] = useState("");
	const [restarting, setRestarting] = useState<string>();
	const [block, setBlock] = useState(false);
	const [breakIn, setBreakIn] = useState(false);

	// Initialize the client
	const client = useMemo(() => {
		const client = new VcmpClient(`ws://${location.host}/mock`, {
			autoStart: true,
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

	// Attach the event handler for openLock in a separate effect,
	// since it depends on the `block` and `breakIn` states.
	useEffect(() => {
		client.on<OpenLockMessage>("openLock", async ({lock}) => {
			const compartment = getCompartmentByLock(lock);
			if (!compartment) {
				throw new Error(`Box not found for lock ${lock}`);
			}
			await handleOpen(compartment);
		});
		return () => {
			client.off("openLock");
		};
	}, [block, breakIn, client]);

	// Helpers for lock status
	function hasLockStatus(lock?: string, status?: LockStatus): lock is string {
		return Boolean(lock && lockStatus[lock] == status);
	}
	const isOpen = (lock?: string) => hasLockStatus(lock, "OPEN");
	const isBlocked = (lock?: string) => hasLockStatus(lock, "BLOCKED");
	const isBreakIn = (lock?: string) => hasLockStatus(lock, "BREAKIN");
	const canClose = (lock?: string) => hasLockStatus(lock, "OPEN") || hasLockStatus(lock, "BREAKIN");

	function applyLockStatus(lock: string, status: LockStatus) {
		setLockStatus(prev => ({
			...prev,
			[lock]: status,
		}));
	}

	async function handleOpen(compartment: Compartment) {
		const {lock, number} = compartment;
		if (lock && !isOpen(lock)) {
			const status = block ? "BLOCKED" : (breakIn ? "BREAKIN" : "OPEN");
			applyLockStatus(lock, status);
			await client.send<LockMessage>({
				"@type": "lock",
				lock: lock,
				compartmentNumber: number,
				status: status,
			});
		}
	}

	async function handleClose(compartment: Compartment) {
		const {lock, number} = compartment;
		if (canClose(lock)) {
			applyLockStatus(lock, "CLOSED");
			await client.send<LockMessage>({
				"@type": "lock",
				lock: lock,
				compartmentNumber: number,
				status: "CLOSED",
			});
		}
	}

	const handleCompartmentClick = async (compartment: Compartment) => {
		if (canClose(compartment.lock)) {
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
			<div className="control-panel">
				<div className="lock-options">
					<div className="lock-option">
						<input
							type="checkbox"
							id="block"
							checked={block}
							onChange={e => setBlock(e.target.checked)}
						/>
						<label htmlFor="block">
							<abbr title="Emulates physical blocking of compartment doors. When sending an open command, the lock will go into the BLOCKED status.">
								Block doors
							</abbr>
						</label>
					</div>
					<div className="lock-option">
						<input
							type="checkbox"
							id="breakin"
							checked={breakIn}
							onChange={e => setBreakIn(e.target.checked)}
						/>
						<label htmlFor="breakin">
							<abbr title="Emulates a break-in. When clicking on a compartment while this option is checked, the lock will go into the BREAKIN status.">
								Break in
							</abbr>
						</label>
					</div>
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
			</div>
			<div className="boxes">
				{compartments.map(compartment => (
					<CompartmentItem
						key={compartment.number}
						compartment={compartment}
						blocked={isBlocked(compartment.lock)}
						breakIn={isBreakIn(compartment.lock)}
						open={isOpen(compartment.lock) || isBreakIn(compartment.lock)}
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
	blocked: boolean;
	breakIn: boolean;
	onClick: (box: Compartment) => void;
};

function CompartmentItem(props: Readonly<CompartmentItemProps>) {
	const {compartment, open, blocked, breakIn, onClick} = props;
	return (
		<div className={`box ${open && "open"}`}>
			<button className={"door border coating"} onClick={() => onClick(compartment)}>
				<div>{compartment.number}</div>
				{blocked && <div className="error-status">Blocked</div>}
				{breakIn && <div className="error-status">Break-In</div>}
			</button>
		</div>
	);
}
