import {
	Alert,
	AlertTitle,
	Avatar,
	Box,
	Button,
	Card,
	CardHeader,
	CircularProgress,
	Container, GlobalStyles,
	Grid,
	List,
	ListItem,
	ListItemIcon,
	ListItemText,
	Stack,
	Typography,
} from "@mui/material";
import {CodeEvent, connect, EventListener, LockEvent, OpenEvent} from "@variocube/cube-app-sdk";
import React, {Fragment, StrictMode, useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

type Timestamped<T> = T & { timestamp: number };

function App() {
	const [connected, setConnected] = useState(false);
	const [lockEvents, setLockEvents] = useState<Timestamped<LockEvent>[]>([]);
	const [codeEvents, setCodeEvents] = useState<Timestamped<CodeEvent>[]>([]);

	const cube = useCube({
		open: () => setConnected(true),
		close: () => setConnected(false),
		lock: lockEvent => setLockEvents(events => [{timestamp: Date.now(), ...lockEvent}, ...events].slice(0, 10)),
		code: codeEvent => setCodeEvents(events => [{timestamp: Date.now(), ...codeEvent}, ...events].slice(0, 10)),
	})

	async function openFirstCompartment() {
		await cube.openCompartment("1");
	}

	async function openAllCompartments() {
		for (const compartment of cube.getCompartments()) {
			await cube.openCompartment(compartment.number);
		}
	}

	return (
		<Container maxWidth="lg" sx={{my: 4}}>
			<GlobalStyles styles={{
				body: {
					backgroundColor: "#f6f6f6",
				}
			}}/>
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
								This demo app requires a connection to the cube app service. The cube app service typically
								runs on an actual locker and is used by the SDK to enable communication with the locker.
								Since you are likely running this demo app on your local machine, you need to start
								the cube app service in order to use its mock implementation of the locker.
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
					This is a mock cube that is used to test the cube app SDK. It will visually display the status
					of compartments and you simulate the opening and closing of compartments. Also, you can simulate
					the scanning of codes.
				</Typography>
				<Card sx={{height: 600, display: "flex", flexFlow: "column", justifyContent: "center"}}>
					{connected
						? <iframe title="Mock Cube" src="http://localhost:5000/" width="100%" height="100%" style={{border: 0}} />
						: (
								<Typography variant="body1" color="textSecondary" align="center">
									The mock cube will be available once the cube app service is started.
								</Typography>
						)}
				</Card>

				<Typography variant="h2">Actions</Typography>
				<Typography variant="body1">
					Here is a list of actions that you can perform on the mock cube.
				</Typography>

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

				<Typography variant="h2">Events</Typography>
				<Typography variant="body1">
					Here is a collection of events that are received from the cube.
				</Typography>
				<Box>
					<Grid container spacing={2}>
						<Grid size={6}>
							<Card>
								<CardHeader title={"Lock Events"} subheader="The last 10 lock events that were received from the cube." />
								<List>
									{lockEvents.map(event => (
										<ListItem>
											<ListItemIcon>
												<Avatar>{event.compartmentNumber}</Avatar>
											</ListItemIcon>
											<ListItemText primary={event.status} secondary={new Date(event.timestamp).toLocaleString()} />
										</ListItem>
									))}
								</List>
							</Card>
						</Grid>
						<Grid size={6}>
							<Card>
								<CardHeader title={"Code Events"} subheader="The last 10 code events that were received from the cube." />
								<List>
									{codeEvents.map(event => (
										<ListItem>
											<ListItemIcon>
												<Avatar>🔑</Avatar>
											</ListItemIcon>
											<ListItemText primary={event.code} secondary={new Date(event.timestamp).toLocaleString()} />
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

interface UseCubeOptions {
	open?: EventListener<OpenEvent>;
	close?: EventListener<CloseEvent>;
	lock?: EventListener<LockEvent>;
	code?: EventListener<CodeEvent>;
}

function useCube(options: UseCubeOptions) {
	const {open, close, lock, code} = options;
	const cube = useMemo(() => connect(), []);

	useEffect(() => {
		if (open) {
			cube.addEventListener("open", open);
		}
		if (close) {
			cube.addEventListener("close", close);
		}
		if (lock) {
			cube.addEventListener("lock", lock);
		}
		if (code) {
			cube.addEventListener("code", code);
		}
		return () => {
			if (open) {
				cube.removeEventListener("open", open);
			}
			if (close) {
				cube.removeEventListener("close", close);
			}
			if (lock) {
				cube.removeEventListener("lock", lock);
			}
			if (code) {
				cube.removeEventListener("code", code);
			}
		}
	}, [cube, open, close, lock, code]);

	return cube;
}
