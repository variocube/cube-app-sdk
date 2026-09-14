import {
	Alert,
	AlertTitle,
	Avatar,
	Box,
	Button,
	Card,
	CardHeader,
	Chip,
	CircularProgress,
	Container,
	FormControlLabel,
	FormHelperText,
	GlobalStyles,
	Grid,
	List,
	ListItem,
	ListItemIcon,
	ListItemText,
	Paper,
	Stack,
	Switch,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	TextField,
	Typography,
} from "@mui/material";
import {
	CubeError,
	CubeProvider,
	useCodeEvent,
	useCompartments,
	useConnected,
	useCube,
	useCubeIdentity,
	useDevices,
	useLockEvent,
	useLocks,
	useOccupancies,
	useStorageItem,
} from "@variocube/cube-app-react-sdk";
import {CodeEvent, LockEvent, Occupancy} from "@variocube/cube-app-sdk";
import React, {Fragment, StrictMode, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";

export function renderApp(session: import("@variocube/cube-app-sdk").ControllerSession) {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<CubeProvider session={session}>
				<App />
			</CubeProvider>
		</StrictMode>,
	);
}

type Timestamped<T> = T & { timestamp: number; id: string };

function App() {
	const [mock, setMock] = useState(false);
	const [hardwareBusy, setHardwareBusy] = useState(false);
	const [hardwareError, setHardwareError] = useState<string>();
	const [hardwareRecovery, setHardwareRecovery] = useState(false);

	const cube = useCube();
	const connected = useConnected();
	const hardwareDisabled = !connected || hardwareBusy || hardwareRecovery;

	async function runHardware(operation: () => Promise<void>) {
		if (hardwareDisabled) return;
		setHardwareBusy(true);
		setHardwareError(undefined);
		try {
			await operation();
		}
		catch (error) {
			setHardwareError(describeError(error));
			if (error instanceof CubeError && error.code === "COMMAND_OUTCOME_UNKNOWN") setHardwareRecovery(true);
		}
		finally {
			setHardwareBusy(false);
		}
	}

	async function openFirstCompartment() {
		await runHardware(() => cube.openCompartment("1"));
	}

	async function openAllCompartments() {
		await runHardware(async () => {
			for (const compartment of cube.compartments) {
				await cube.openCompartment(compartment.number);
			}
		});
	}

	return (
		<Container maxWidth="lg" sx={{my: 4}}>
			<GlobalStyles
				styles={{
					body: {
						backgroundColor: "#f6f6f6",
					},
				}}
			/>
			<Stack spacing={4}>
				<Box>
					<Typography variant="overline">Variocube Cube App SDK</Typography>
					<Typography variant="h1">Demo App</Typography>
				</Box>

				<Alert severity={connected ? "success" : "info"} icon={!connected ? <CircularProgress /> : undefined}>
					<AlertTitle>
						{connected ? "Connected to cube app service" : "Waiting for connection to cube app service..."}
					</AlertTitle>
					{!connected && (
						<Fragment>
							<Typography variant="body1" gutterBottom>
								This demo app requires a connection to the cube app service. The cube app service
								typically runs on an actual locker and is used by the SDK to enable communication with
								the locker. Since you are likely running this demo app on your local machine, you need
								to start the cube app service in order to use its mock implementation of the locker.
							</Typography>
							<Typography variant="body1">
								Please start the cube app service locally with:
							</Typography>
							<pre>
								<code>
									npx @variocube/cube-app-service
								</code>
							</pre>
						</Fragment>
					)}
				</Alert>
				<IdentityCard />
				<OccupancyCard />
				<StorageCard />
				<Typography variant="h2">Mock Cube</Typography>
				<Typography variant="body1">
					This is a mock cube that is used to test the cube app SDK. It will visually display the status of
					compartments and you simulate the opening and closing of compartments. Also, you can simulate the
					scanning of codes.
				</Typography>
				{mock && (
					<Card sx={{height: 600, display: "flex", flexFlow: "column", justifyContent: "center"}}>
						{connected
							? (
								<iframe
									title="Mock Cube"
									src="http://localhost:4000/"
									width="100%"
									height="100%"
									style={{border: 0}}
								/>
							)
							: (
								<Typography variant="body1" color="textSecondary" align="center">
									The mock cube will be available once the cube app service is started.
								</Typography>
							)}
					</Card>
				)}
				<Box>
					<FormControlLabel
						label="Use Mock Cube"
						control={<Switch checked={mock} onChange={() => setMock(!mock)} />}
					/>
					<FormHelperText>
						Enable the mock for hardware UI testing. Occupancies and storage require a real controller.
					</FormHelperText>
				</Box>

				<Typography variant="h2">Actions</Typography>
				<Typography variant="body1">
					Hardware actions are sent to the connected locker or enabled mock.
				</Typography>
				{hardwareError && <Alert severity="warning">{hardwareError}</Alert>}
				{hardwareRecovery && (
					<Alert severity="warning">
						A hardware command has an unknown outcome. Further hardware actions are blocked, including after
						reconnect or app changes. An operator must inspect the controller and actual door state before
						starting a new demo session. An occupancy snapshot alone cannot establish whether a lock opened.
					</Alert>
				)}

				<Stack spacing={2} direction="row">
					<Button
						variant="outlined"
						disabled={hardwareDisabled}
						onClick={() => runHardware(() => cube.restartOperatingSystem())}
					>
						Restart Operating System
					</Button>
					<Button
						variant="outlined"
						disabled={hardwareDisabled}
						onClick={() => runHardware(() => cube.restartUserInterface())}
					>
						Restart User Interface
					</Button>
					<Button variant="outlined" disabled={hardwareDisabled} onClick={openFirstCompartment}>
						Open First Compartment
					</Button>
					<Button variant="outlined" disabled={hardwareDisabled} onClick={openAllCompartments}>
						Open All Compartments
					</Button>
				</Stack>

				<Typography variant="h2">Compartments</Typography>
				<Typography variant="body1">
					These are the compartments of the cube.
				</Typography>
				<CompartmentListCard
					disabled={hardwareDisabled}
					onOpen={lock => runHardware(() => cube.openLock(lock))}
				/>

				<Typography variant="h2">Devices</Typography>
				<Typography variant="body1">
					This is a list of devices that are currently connected to the cube.
				</Typography>
				<DeviceListCard />

				<Typography variant="h2">Events</Typography>
				<Typography variant="body1">
					Here is a collection of events that are received from the cube.
				</Typography>
				<Box>
					<Grid container spacing={2}>
						<Grid size={6}>
							<LockEventCard />
						</Grid>
						<Grid size={6}>
							<CodeEventCard />
						</Grid>
					</Grid>
				</Box>
			</Stack>
		</Container>
	);
}

function IdentityCard() {
	const identity = useCubeIdentity();
	return (
		<Paper sx={{p: 3}}>
			<Typography variant="h2">Controller identity</Typography>
			{identity
				? (
					<Stack spacing={1}>
						<Typography>Cube: {identity.cubeId}</Typography>
						<Typography>Installed app: {identity.appId ?? "No single installed app"}</Typography>
						<Typography>
							Token expires:{" "}
							{identity.expiresAt ? new Date(identity.expiresAt * 1000).toLocaleString() : "Unavailable"}
						</Typography>
					</Stack>
				)
				: <Typography>Waiting for the controller identity.</Typography>}
		</Paper>
	);
}

interface Recovery {
	operation: "allocate" | "confirm" | "cancel" | "end";
	reference: string;
	uuid?: string;
	cubeId?: string;
	appId?: string | null;
}

function describeError(error: unknown): string {
	return error instanceof CubeError
		? `${error.code}: ${error.message}`
		: error instanceof Error
		? error.message
		: String(error);
}

function OccupancyCard() {
	const cube = useCube();
	const identity = useCubeIdentity();
	const occupancies = useOccupancies();
	const [boxNumber, setBoxNumber] = useState("1");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string>();
	const [recovery, setRecovery] = useState<Recovery>();
	const disabled = busy || !!recovery || occupancies.status !== "ready";

	async function mutate(operation: Recovery["operation"], occupancy?: Occupancy) {
		const attempt: Recovery = {
			operation,
			reference: crypto.randomUUID(),
			uuid: occupancy?.uuid,
			cubeId: identity?.cubeId,
			appId: identity?.appId,
		};
		setBusy(true);
		setMessage(undefined);
		try {
			if (operation === "allocate") {
				const created = await cube.occupancies.occupyBox({
					boxNumber,
					content: {demoReference: attempt.reference},
				});
				setMessage(`Reserved occupancy ${created.uuid}.`);
			}
			else if (occupancy) {
				await cube.occupancies[operation](occupancy.uuid);
			}
		}
		catch (error) {
			setMessage(describeError(error));
			if (error instanceof CubeError && error.code === "COMMAND_OUTCOME_UNKNOWN") setRecovery(attempt);
		}
		finally {
			setBusy(false);
		}
	}

	async function reconcile() {
		if (!recovery) return;
		if (identity?.cubeId !== recovery.cubeId || identity?.appId !== recovery.appId) {
			setMessage("Reconnect the original cube and app before reconciling this operation.");
			return;
		}
		setBusy(true);
		try {
			const current = await cube.occupancies.list();
			const match = current.find(item =>
				recovery.uuid
					? item.uuid === recovery.uuid
					: item.content?.demoReference === recovery.reference
			);
			const resolved = recovery.operation === "allocate"
				? !!match
				: recovery.operation === "confirm"
				? match?.state === "confirmed"
				: !match || match.state === "ended";
			if (resolved) {
				setRecovery(undefined);
				setMessage(
					match
						? `Reconciled occupancy ${match.uuid}: ${match.state}.`
						: "The occupancy is no longer active.",
				);
			}
			else {
				setMessage(
					"The refreshed snapshot cannot resolve this operation. Keep this reference for operator reconciliation; allocation remains blocked.",
				);
			}
		}
		catch (error) {
			setMessage(describeError(error));
		}
		finally {
			setBusy(false);
		}
	}

	return (
		<Paper sx={{p: 3}}>
			<Stack spacing={2}>
				<Typography variant="h2">Occupancies</Typography>
				<Typography>
					Connect the service to a real controller, including its memory mode, with exactly one installed app.
					Reservations and storage are held by that controller.
				</Typography>
				{occupancies.status !== "ready" && (
					<Alert severity={occupancies.status === "error" ? "error" : "info"}>
						Occupancies: {occupancies.status}. {occupancies.error?.message}
					</Alert>
				)}
				{message && <Alert severity={recovery ? "warning" : "info"}>{message}</Alert>}
				{recovery && (
					<Alert
						severity="warning"
						action={<Button disabled={busy} onClick={reconcile}>Refresh and reconcile</Button>}
					>
						The {recovery.operation} outcome is unknown. Reference:{" "}
						{recovery.uuid ?? recovery.reference}. Mutations stay blocked until the authoritative snapshot
						resolves the operation.
					</Alert>
				)}
				<Stack direction="row" spacing={2}>
					<TextField
						label="Box number"
						value={boxNumber}
						onChange={event => setBoxNumber(event.target.value)}
					/>
					<Button variant="contained" disabled={disabled || !boxNumber} onClick={() => mutate("allocate")}>
						Reserve box
					</Button>
				</Stack>
				{occupancies.status === "ready" && occupancies.data?.length === 0 && (
					<Typography>No occupancies.</Typography>
				)}
				{occupancies.data?.map(occupancy => (
					<Stack key={occupancy.uuid} direction="row" spacing={1} alignItems="center">
						<Typography sx={{flex: 1}}>
							Box {occupancy.boxNumber}: {occupancy.state} ({occupancy.uuid})
						</Typography>
						<Button
							disabled={disabled || occupancy.state !== "pending"}
							onClick={() =>
								mutate("confirm", occupancy)}
						>
							Confirm
						</Button>
						<Button
							disabled={disabled || occupancy.state !== "pending"}
							onClick={() =>
								mutate("cancel", occupancy)}
						>
							Cancel reservation
						</Button>
						<Button
							disabled={disabled || occupancy.state !== "confirmed"}
							onClick={() =>
								mutate("end", occupancy)}
						>
							End
						</Button>
					</Stack>
				))}
			</Stack>
		</Paper>
	);
}

function StorageCard() {
	const [key, setKey] = useState("planned-handovers");
	const item = useStorageItem<unknown>(key);
	return (
		<Paper sx={{p: 3}}>
			<Stack spacing={2}>
				<Typography variant="h2">Controller storage</Typography>
				<Typography>
					Documents are written by the Center and remain readable from the controller while offline.
				</Typography>
				<TextField label="Document key" value={key} onChange={event => setKey(event.target.value)} />
				<Typography>JSON read: {item.status}</Typography>
				{item.error && (
					<Alert severity={item.status === "not-found" ? "info" : "warning"}>
						{describeError(item.error)}
					</Alert>
				)}
				{item.status === "ready" && (
					<Box component="pre" sx={{overflow: "auto"}}>{JSON.stringify(item.data, null, 2)}</Box>
				)}
				<StorageBlobPreview documentKey={key} />
			</Stack>
		</Paper>
	);
}

function StorageBlobPreview({documentKey}: { documentKey: string }) {
	const cube = useCube();
	const identity = useCubeIdentity();
	const generation = useRef(0);
	const [details, setDetails] = useState<string>();
	useEffect(() => {
		const clear = () => {
			generation.current++;
			setDetails(undefined);
		};
		const changed = ({key}: { key: string }) => {
			if (key === documentKey) clear();
		};
		cube.addEventListener("storage", changed);
		cube.addEventListener("availability", clear);
		clear();
		return () => {
			generation.current++;
			cube.removeEventListener("storage", changed);
			cube.removeEventListener("availability", clear);
		};
	}, [cube, documentKey, identity?.cubeId, identity?.appId]);
	async function readBlob() {
		const current = ++generation.current;
		setDetails("Loading binary representation…");
		try {
			const blob = await cube.storage.getBlob(documentKey);
			if (current === generation.current) {
				setDetails(`${blob.type || "Unknown content type"}, ${blob.size} bytes`);
			}
		}
		catch (error) {
			if (current === generation.current) setDetails(describeError(error));
		}
	}
	return (
		<Stack direction="row" spacing={2} alignItems="center">
			<Button onClick={readBlob} disabled={cube.storage.state.status !== "ready"}>Read as blob</Button>
			{details && <Typography>{details}</Typography>}
		</Stack>
	);
}

function CompartmentListCard({disabled, onOpen}: { disabled: boolean; onOpen: (lock: string) => Promise<void> }) {
	const compartments = useCompartments();
	const locks = useLocks();

	return (
		<Paper>
			<TableContainer>
				<Table>
					<TableHead>
						<TableRow>
							<TableCell>Number</TableCell>
							<TableCell>Types</TableCell>
							<TableCell>Features</TableCell>
							<TableCell>Enabled</TableCell>
							<TableCell>Lock</TableCell>
							<TableCell>Secondary Lock</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{compartments.map(compartment => (
							<TableRow key={compartment.number}>
								<TableCell>{compartment.number}</TableCell>
								<TableCell>{compartment.types.join(", ")}</TableCell>
								<TableCell>{compartment.features.join(", ")}</TableCell>
								<TableCell>{compartment.enabled ? "Yes" : "No"}</TableCell>
								<TableCell>
									{compartment.lock}
									{compartment.lock && <Chip label={locks[compartment.lock]} />}
									<Button
										disabled={disabled || !compartment.lock}
										onClick={() => compartment.lock && onOpen(compartment.lock)}
									>
										Open
									</Button>
								</TableCell>
								<TableCell>
									{compartment.secondaryLock}
									{compartment.secondaryLock && <Chip label={locks[compartment.secondaryLock]} />}
									<Button
										disabled={disabled || !compartment.secondaryLock}
										onClick={() => compartment.secondaryLock && onOpen(compartment.secondaryLock)}
									>
										Open
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>
		</Paper>
	);
}

function DeviceListCard() {
	const devices = useDevices();

	return (
		<Paper>
			<List>
				{devices.map(device => (
					<ListItem key={device.id}>
						<ListItemIcon>
							<Avatar>🖥</Avatar>
						</ListItemIcon>
						<ListItemText
							primary={device.model}
							secondary={device.vendor}
						/>
					</ListItem>
				))}
			</List>
		</Paper>
	);
}

function LockEventCard() {
	const [lockEvents, setLockEvents] = useState<Timestamped<LockEvent>[]>([]);

	useLockEvent(lockEvent =>
		setLockEvents(events =>
			[{id: crypto.randomUUID(), timestamp: Date.now(), ...lockEvent}, ...events].slice(0, 10)
		)
	);

	return (
		<Card>
			<CardHeader
				title={"Lock Events"}
				subheader="The last 10 lock events that were received from the cube."
			/>
			<List>
				{lockEvents.map(event => (
					<ListItem key={event.id}>
						<ListItemIcon>
							<Avatar>{event.compartmentNumber}</Avatar>
						</ListItemIcon>
						<ListItemText
							primary={event.status}
							secondary={new Date(event.timestamp).toLocaleString()}
						/>
					</ListItem>
				))}
			</List>
		</Card>
	);
}

function CodeEventCard() {
	const [codeEvents, setCodeEvents] = useState<Timestamped<CodeEvent>[]>([]);

	useCodeEvent(codeEvent =>
		setCodeEvents(events =>
			[{id: crypto.randomUUID(), timestamp: Date.now(), ...codeEvent}, ...events].slice(0, 10)
		)
	);

	return (
		<Card>
			<CardHeader
				title={"Code Events"}
				subheader="The last 10 code events that were received from the cube."
			/>
			<List>
				{codeEvents.map(event => (
					<ListItem key={event.id}>
						<ListItemIcon>
							<Avatar>🔑</Avatar>
						</ListItemIcon>
						<ListItemText
							primary={event.code}
							secondary={new Date(event.timestamp).toLocaleString()}
						/>
					</ListItem>
				))}
			</List>
		</Card>
	);
}
