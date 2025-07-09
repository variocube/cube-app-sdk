import {
	Alert,
	AlertTitle,
	Avatar,
	Box,
	Button,
	Card,
	CardHeader,
	CircularProgress,
	Container,
	Grid,
	List,
	ListItem,
	ListItemIcon,
	ListItemText,
	Stack,
	Typography,
} from "@mui/material";
import {CodeEvent, connect, LockEvent} from "@variocube/cube-app-sdk";
import React, {Fragment, StrictMode, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

function App() {
	const [connected, setConnected] = useState(false);
	const [lockEvents, setLockEvents] = useState<LockEvent[]>([]);
	const [codeEvents, setCodeEvents] = useState<CodeEvent[]>([]);

	const cube = useMemo(() => {
		const cube = connect();
		cube.addEventListener("lock", lockEvent => setLockEvents(events => [...events, lockEvent]));
		cube.addEventListener("open", () => setConnected(true));
		cube.addEventListener("close", () => setConnected(false));
		cube.addEventListener("code", codeEvent => setCodeEvents(events => [...events, codeEvent]));
		return cube;
	}, []);

	function openFirstCompartment() {
		cube.openCompartment("1");
	}

	function openAllCompartments() {
		for (const compartment of cube.getCompartments()) {
			cube.openCompartment(compartment.number);
		}
	}

	return (
		<Container maxWidth="md">
			<Stack spacing={2}>
				<Typography variant="h1">Variocube Cube App SDK Demo App</Typography>

				<Alert severity={connected ? "success" : "info"} icon={!connected ? <CircularProgress /> : undefined}>
					<AlertTitle>
						{connected ? "Connected to cube app service" : "Waiting for connection to cube app service..."}
					</AlertTitle>
					{!connected && (
						<Fragment>
							Please start the cube app service with:
							<pre>
								<code>
									npx @variocube/cube-app-service
								</code>
							</pre>
						</Fragment>
					)}
				</Alert>
				<Stack spacing={2} direction="row">
					<Button variant="outlined" disabled={!connected} onClick={() => cube.restart()}>
						Restart Cube
					</Button>
					<Button variant="outlined" disabled={!connected} onClick={openFirstCompartment}>
						Open First Compartment
					</Button>
					<Button variant="outlined" disabled={!connected} onClick={openAllCompartments}>
						Open All Compartments
					</Button>
				</Stack>
				<Typography variant="h2">Mock Cube</Typography>
				<Typography variant="body1">
					This is a mock cube that is used to test the cube app SDK.
				</Typography>
				{connected
					? <iframe title="Mock Cube" src="http://localhost:5000/" width="100%" height="500px" />
					: (
						<Box height={500} display="flex" justifyContent="center" alignItems="center">
							The mock cube will be available once the cube app service is started.
						</Box>
					)}
				<Box>
					<Grid container spacing={2}>
						<Grid size={6}>
							<Card>
								<CardHeader title={"Lock Events"} />
								<List>
									{lockEvents.map(event => (
										<ListItem>
											<ListItemIcon>
												<Avatar>{event.compartmentNumber}</Avatar>
											</ListItemIcon>
											<ListItemText primary={event.status} />
										</ListItem>
									))}
								</List>
							</Card>
						</Grid>
						<Grid size={6}>
							<Card>
								<CardHeader title={"Code Events"} />
								<List>
									{codeEvents.map(event => (
										<ListItem>
											<ListItemIcon>
												<Avatar>🔑</Avatar>
											</ListItemIcon>
											<ListItemText primary={event.code} />
										</ListItem>
									))}
								</List>
							</Card>
						</Grid>
					</Grid>
				</Box>
			</Stack>
		</Container>
	);
}
