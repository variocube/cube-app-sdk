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
	Typography,
} from "@mui/material";
import {
	CubeProvider,
	useCodeEvent,
	useCompartments,
	useConnected,
	useCube,
	useDevices,
	useLockEvent,
	useLocks,
} from "@variocube/cube-app-react-sdk";
import {CodeEvent, LockEvent} from "@variocube/cube-app-sdk";
import React, {Fragment, StrictMode, useState} from "react";
import {createRoot} from "react-dom/client";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<CubeProvider>
			<App />
		</CubeProvider>
	</StrictMode>,
);

type Timestamped<T> = T & { timestamp: number };

function App() {
	const [mock, setMock] = useState(true);

	const cube = useCube();
	const connected = useConnected();

	async function openFirstCompartment() {
		await cube.openCompartment("1");
	}

	async function openAllCompartments() {
		for (const compartment of cube.compartments) {
			await cube.openCompartment(compartment.number);
		}
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
				<Typography variant="h2">Mock Cube</Typography>
				<Typography variant="body1">
					This is a mock cube that is used to test the cube app SDK. It will visually display the status of
					compartments and you simulate the opening and closing of compartments. Also, you can simulate the
					scanning of codes.
				</Typography>
				<Card sx={{height: 600, display: "flex", flexFlow: "column", justifyContent: "center"}}>
					{(mock && connected)
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
				<Box>
					<FormControlLabel
						label="Use Mock Cube"
						control={<Switch checked={mock} onChange={() => setMock(!mock)} />}
					/>
					<FormHelperText>
						You can switch off the mock cube, if you want to run the demo app against a Variocube Locker.
					</FormHelperText>
				</Box>

				<Typography variant="h2">Actions</Typography>
				<Typography variant="body1">
					Here is a list of actions that you can perform on the mock cube.
				</Typography>

				<Stack spacing={2} direction="row">
					<Button variant="outlined" disabled={!connected} onClick={() => cube.restartOperatingSystem()}>
						Restart Operating System
					</Button>
					<Button variant="outlined" disabled={!connected} onClick={() => cube.restartUserInterface()}>
						Restart User Interface
					</Button>
					<Button variant="outlined" disabled={!connected} onClick={openFirstCompartment}>
						Open First Compartment
					</Button>
					<Button variant="outlined" disabled={!connected} onClick={openAllCompartments}>
						Open All Compartments
					</Button>
				</Stack>

				<Typography variant="h2">Compartments</Typography>
				<Typography variant="body1">
					These are the compartments of the cube.
				</Typography>
				<CompartmentListCard />

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

function CompartmentListCard() {
	const compartments = useCompartments();
	const locks = useLocks();
	const cube = useCube();

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
										disabled={!compartment.lock}
										onClick={() => compartment.lock && cube.openLock(compartment.lock)}
									>
										Open
									</Button>
								</TableCell>
								<TableCell>
									{compartment.secondaryLock}
									{compartment.secondaryLock && <Chip label={locks[compartment.secondaryLock]} />}
									<Button
										disabled={!compartment.secondaryLock}
										onClick={() =>
											compartment.secondaryLock && cube.openLock(compartment.secondaryLock)}
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
					<ListItem>
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

	useLockEvent(lockEvent => setLockEvents(events => [{timestamp: Date.now(), ...lockEvent}, ...events].slice(0, 10)));

	return (
		<Card>
			<CardHeader
				title={"Lock Events"}
				subheader="The last 10 lock events that were received from the cube."
			/>
			<List>
				{lockEvents.map(event => (
					<ListItem>
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

	useCodeEvent(codeEvent => setCodeEvents(events => [{timestamp: Date.now(), ...codeEvent}, ...events].slice(0, 10)));

	return (
		<Card>
			<CardHeader
				title={"Code Events"}
				subheader="The last 10 code events that were received from the cube."
			/>
			<List>
				{codeEvents.map(event => (
					<ListItem>
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
