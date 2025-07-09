#!/bin/bash

### Copyright (2022-2023) Variocube GmbH
### This program supports setting up or refreshing Variocube software projects.

### Utility functions

# Die with an error message
die() {
	echo >&2 "$@"
	exit 1
}

# Print the usage message
usage() {
  die "Usage: $0 <command> [command]"
}

confirm() {
	read -r -p "${1:-Are you sure?} [y/N] " response
	case "$response" in
		[yY][eE][sS]|[yY])
			true
			;;
		*)
			false
			;;
	esac
}

# Print the help screen
help() {
  echo "Variocube project setup tool"
  echo ""
  echo "Supported commands:"
  echo "    init:           Creates the initial config file and fetches the initial copy of devtools into .devtools."
  echo "    setup:          Setup this project from scratch, runs an initial npm run dev if a package.json is found and"
  echo "                    a ./gradlew build if a build.gradle is found."
  echo "    assertSetup:    Checks if all prerequisites are met and exits with an error if not."
  echo "    update:         Updates devtools to the newest version from the repository."
  echo "    databaseCreate: Creates a database according to the configuration in .vc."
  echo "    databaseDrop:   Drops the local database according to the configuration in .vc."
  echo "    databaseImport: Imports a database from a dump file into the local server. If no dump file is specified via"
  echo "                    the -d switch, then the latest dump file from the S3 bucket is used."
  echo "                    By default the dump is left compressed, the -u switch uncompresses the dump."
  echo "    cleanDbDir:     Deletes everything in the .databases Directory"
  echo "    tailLogs:       Tails logs from CloudWatch as configured in .vc. By default the logs of the app stage are"
  echo "                    shown. Use the -s <stage> switch to specify a specific stage."
  echo ""
  echo "For Linux Users:"
  echo "    Leave the MySQL server password at the prompt empty. Then the mysql commands for root run with sudo."
  echo ""

  if [ ! -z "$1" ] ; then
    case "$1" in
      setup)
        echo "Setup does not require any additional parameters and tries to setup this project from scratch."
        ;;
      assertSetup)
        echo "assertSetup does not require any additional parameters and checks if all prerequisites are met."
        ;;
    esac
  fi

  usage
}

### Global variables and setup
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
WORK_DIR=$(pwd)
CONFIG_FILE="${WORK_DIR}/.vc"
DEVTOOLS_DIR="${WORK_DIR}/.devtools"

updateDevTools() {
	PROJECT_DIR="${1}"
	if [[ -z "${PROJECT_DIR}" ]] ; then
		die "Cannot update devtools without a project directory. Missing parameter to function updateDevTools."
	fi
	# Remove existing .devtools directory and create a fresh clone from the repository
	echo -n "Downloading current version of devtools ... "
	wget -q https://github.com/variocube/devtools/archive/refs/heads/main.zip -O "${PROJECT_DIR}/devtools.zip" || die "Failed to download devtools from repository"
	echo "OK"
	echo -n "Unpacking new version of devtools ... "
	unzip -q "${PROJECT_DIR}/devtools.zip" || die "Failed to unzip devtools"
	echo "OK"
	echo -n "Installing and linking new version of devtools ... "
	rm -rf "${DEVTOOLS_DIR}"
	mv "${PROJECT_DIR}/devtools-main" "${PROJECT_DIR}/.devtools"
	rm "${PROJECT_DIR}/devtools.zip"
	rm -rf "${PROJECT_DIR}/.devtools/.idea"
	# Link files from .devtools into the project root
	pushd "${PROJECT_DIR}" > /dev/null
	ln -srf ".devtools/devtools.sh" "devtools.sh"
	ln -srf ".devtools/.editorconfig" ".editorconfig"
	ln -srf ".devtools/dprint.json" "dprint.json"
	# Link IDEA settings
	mkdir -p "./idea"
	mkdir -p "./idea/codeStyles"
	ln -srf ".devtools/idea/codeStyles/codeStyleConfig.xml" ".idea/codeStyles/codeStyleConfig.xml"
	ln -srf ".devtools/idea/codeStyles/Project.xml" ".idea/codeStyles/Project.xml"
	ln -srf ".devtools/idea/dprintProjectConfig.xml" ".idea/dprintProjectConfig.xml"
	ln -srf ".devtools/idea/dprintUserConfig.xml" ".idea/dprintUserConfig.xml"
	# Link GitHub settings
	mkdir -p ".github"
	ln -srf ".devtools/ISSUE_TEMPLATE.md" ".github/ISSUE_TEMPLATE.md"
	ln -srf ".devtools/PULL_REQUEST_TEMPLATE.md" ".github/PULL_REQUEST_TEMPLATE.md"
	popd > /dev/null
	echo "OK"
}

# Init an empty .vc configuration
init() {
	confirm "Do you really want to initialize a new project in ${WORK_DIR}?" || exit 1
	if [ ! -f "${CONFIG_FILE}" ]; then
		# Create initial .vc configuration file
  	cat << EOF > "${CONFIG_FILE}"
JAVA_VERSION=11
NODE_VERSION=14
NPM_VERSION=8
VC_AWS_REGION=eu-west-1
VC_AWS_PROFILE=variocube
# DATABASE_NAME=app_database_name
EOF
	fi
	updateDevTools "${WORK_DIR}"
}

if [ "$1" == "init" ] ; then
  if [[ -f "${CONFIG_FILE}" ]] ; then
    die "Configuration file already exists, aborting. Please delete ${CONFIG_FILE} if you want to reinitialize."
  fi
  if [[ -d "${DEVTOOLS_DIR}" ]] ; then
  	die "Devtools directory already exists, aborting. Please delete ${DEVTOOLS_DIR} if you want to reinitialize."
	fi
  init
  exit 0
fi

### Check and source configuration file
if [[ ! -f "$CONFIG_FILE" ]] ; then
  die "Configuration file $CONFIG_FILE not found. Please run ${0} init first."
fi
source "$CONFIG_FILE"

## AWS Profiles from environment variables or .vc
if [[ -z "${AWS_PROFILE}" ]] ; then
	if [[ -z "${VC_AWS_PROFILE}" ]] ; then
		die "No AWS profile set. Please set the environment variable AWS_PROFILE or the variable VC_AWS_PROFILE in .vc."
	fi
	export AWS_PROFILE="${VC_AWS_PROFILE}"
fi
if [[ -z "${AWS_REGION}" ]] ; then
	if [[ -z "${VC_AWS_REGION}" ]] ; then
  		die "No AWS region set. Please set the environment variable AWS_REGION or the variable VC_AWS_REGION in .vc."
  	fi
	export AWS_REGION="${VC_AWS_REGION}"
fi

### Library functions

# Assert that Java is installed and at a certain version
assertJavaVersion() {
  if [ -z "$1" ] ; then
    die "No Java version specified"
  fi
  if ! command -v java &> /dev/null ; then
    die "Java is not installed"
  fi
  JAVA_VER=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | sed '/^1\./s///' | cut -d'.' -f1)
  [ "$JAVA_VER" == "$1" ] || die "Java version $1 is required but we found ${JAVA_VER}"
}

# Assert that Node is installed and at a certain version
assertNodeVersion() {
  if [ -z "$1" ] ; then
    die "No Node version specified"
  fi
  if ! command -v node &> /dev/null ; then
    die "Node is not installed"
  fi
  NODE_VER=$(node -v | sed '/^v/s///' | cut -d'.' -f1)
  [ "$NODE_VER" == "$1" ] || die "Node version $1 is required but we found ${NODE_VER}"
}

# Assert that NPM is installed and at a certain version
assertNpmVersion() {
  if [ -z "$1" ] ; then
    die "No NPM version specified"
  fi
  if ! command -v npm &> /dev/null ; then
    die "NPM is not installed"
  fi
  NPM_VER=$(npm -v | cut -d'.' -f1)
  [ "$NPM_VER" == "$1" ] || die "NPM version $1 is required but we found ${NPM_VER}"
}

# Check if AWS CLI is installed
assertAwsCli() {
  if ! command -v aws &> /dev/null ; then
    die "AWS CLI is not installed"
  fi
}

### Actual payload functions

# Assert machine setup
assertSetup() {
  assertJavaVersion "${JAVA_VERSION}"
  assertNodeVersion "${NODE_VERSION}"
  assertNpmVersion "${NPM_VERSION}"
  assertAwsCli
}

# Setup the project
setup() {
  assertSetup
  if [ -f "package.json" ]; then
    echo "Found package.json, running npm install..."
    npm install
  fi
  if [ -f "build.gradle" ]; then
    echo "Found build.gradle, running ./gradlew build..."
    ./gradlew build
  fi
}

setSudo() {
	# when PW is empty and OS is Linux, root mysql commands are called with "sudo"
	if [[ "$OSTYPE" == "linux-gnu"* ]]; then
		if [[ -z "$1" ]] ; then
  		sudo="sudo"
  	fi
  else
  	sudo=""
	fi
}

assertDatabaseConfiguration() {
	if [[ -z "${DATABASE_NAME}" ]] ; then
		die "Cannot initialize database without a database name. Please set the DATABASE_NAME variable in ${CONFIG_FILE}."
	fi
}

# Create a new empty local database
databaseCreate() {
	echo -n "Please enter the root password for the local MySQL server: "
  read -s pass
  echo ""
	assertDatabaseConfiguration
	setSudo ${pass}
	echo "Creating database ${DATABASE_NAME} ..."
	echo "CREATE DATABASE IF NOT EXISTS ${DATABASE_NAME};" | "${sudo}" mysql -u root -p${pass} || die "Could not create database ${DATABASE_NAME}"
	echo "Grant all Priviliges on ${DATABASE_NAME} ..."
	echo "GRANT ALL PRIVILEGES ON ${DATABASE_NAME}.* TO '${DATABASE_NAME}'@'localhost';" | "${sudo}" mysql -u root -p${pass} || die "Could not grant privileges for ${DATABASE_NAME}"
	echo "OK"
}

# Drop the local database
databaseDrop() {
	echo -n "Please enter the root password for the local MySQL server: "
	read -s pass
	echo ""
	assertDatabaseConfiguration
	setSudo ${pass}
	echo "Dropping database ${DATABASE_NAME} ..."
	echo "DROP DATABASE ${DATABASE_NAME};" | "${sudo}" mysql -u root -p${pass} || die "Could not drop database ${DATABASE_NAME}"
	echo "OK"
}

# Import a database dump into the local database
databaseImportDump() {
	DATABASE_DUMP_FILE="${1}"
	if [ -z "${DATABASE_DUMP_FILE}" ] ; then
		die "No database dump file specified"
	fi
	if [ ! -f "${DATABASE_DUMP_FILE}" ] ; then
		die "Database dump file ${DATABASE_DUMP_FILE} not found"
	fi
	assertDatabaseConfiguration
	echo -n "Please enter the root password for the local MySQL server: "
	read -s pass
	setSudo ${pass}
	echo ""
	echo -n "Importing database dump ${DATABASE_DUMP_FILE} into ${DATABASE_NAME} ..."
	echo ""
	if [[ ${DATABASE_DUMP_FILE} == *.sql ]] ; then
		"${sudo}" mysql -u root -p${pass} ${DATABASE_NAME} < "${DATABASE_DUMP_FILE}" || die "Could not import database dump ${DATABASE_DUMP_FILE}"
	else
		# assume it's a .gz file
		zcat "${DATABASE_DUMP_FILE}" | "${sudo}" mysql -u root -p${pass} ${DATABASE_NAME} || die "Could not import compressed database dump ${DATABASE_DUMP_FILE}"
	fi
	echo "OK"
}

# Import database from dump, download from S3 if no specific dump is specified
databaseImport() {
	assertDatabaseConfiguration
	assertAwsCli
	DATABASE_DUMP_FILE="${1}"
	if [[ -z "${DATABASE_DUMP_FILE}" ]] ; then
		mkdir -p "${WORK_DIR}/.databases"
		if [[ "$OSTYPE" == "linux-gnu"* ]]; then
			YESTERDAY=$(date -d "-1day" +%Y-%m-%d)
  	elif [[ "$OSTYPE" == "darwin"* ]]; then
			YESTERDAY=$(date -v-1d +%Y-%m-%d)
		fi
		TODAYS_BACKUP="${YESTERDAY}-${DATABASE_NAME}.sql.gz"
		echo "Downloading latest backup ${TODAYS_BACKUP} from S3"
		aws s3 cp "s3://vc-aws-infrastructure/rds-backups/${TODAYS_BACKUP}" "${WORK_DIR}/.databases/${TODAYS_BACKUP}" --region "${AWS_REGION}" --profile "${AWS_PROFILE}" || die "Could not download latest backup ${TODAYS_BACKUP}"
		if [[ ${UNCOMPRESS_DUMP} == 1 ]] ; then
			gunzip "${WORK_DIR}/.databases/${TODAYS_BACKUP}" || die "Could not unzip ${WORK_DIR}/.databases/${TODAYS_BACKUP}"
			DATABASE_DUMP_FILE="${WORK_DIR}/.databases/${YESTERDAY}-${DATABASE_NAME}.sql"
		else
			DATABASE_DUMP_FILE="${WORK_DIR}/.databases/${YESTERDAY}-${DATABASE_NAME}.sql.gz"
		fi
	fi
	databaseImportDump "${DATABASE_DUMP_FILE}"
}

# Tail CloudWatch logs
tailCloudWatchLogs() {
	assertAwsCli
	if [[ -z "${STAGE}" ]] ; then
		STAGE="app"
	fi
	LOG_GROUP_NAME=CLOUD_WATCH_LOG_GROUP_${STAGE}
  if [[ -z "${!LOG_GROUP_NAME}" ]] ; then
		die "No CloudWatch log group name found for stage ${STAGE}. Please set the CLOUD_WATCH_LOG_GROUP_${STAGE} variable in ${CONFIG_FILE}."
	fi
	aws logs tail --follow --region "${AWS_REGION}" --profile "${AWS_PROFILE}" "${!LOG_GROUP_NAME}"
}

# Deletes everything in the .database Directory
cleanDbDirectory() {
	echo -n "Do you really want to delete all files in ${WORK_DIR}/.databases/ ? (yes or n): "
	read del
	if [ ${del} == "yes" ] ; then
		echo "Cleaning the .databases directory ..."
		rm -v ${WORK_DIR}/.databases/*
	else
		echo "OK, nothing was deleted"
	fi
}

# Check if we have any command at all
[ "$#" -ge 1 ] || usage

case "$1" in
  # Simple commands with no arguments
  setup)
    COMMAND="$1"
    shift
    ;;
  assertSetup)
    COMMAND="$1"
    shift
    ;;
  update)
		COMMAND="$1"
		shift
		;;
	databaseCreate)
		COMMAND="$1"
		shift
		;;
	databaseDrop)
		COMMAND="$1"
		shift
		;;
	databaseImport)
		COMMAND="$1"
		shift
		;;
	tailLogs)
		COMMAND="$1"
		shift
		;;
	cleanDbDir)
		COMMAND="$1"
		shift
		;;
  *)
    echo "Unknown command: $1"
    help
    ;;
esac

# Parse options
while getopts "hvs:d:u" OPTION; do
  case $OPTION in
    h)
      help "${COMMAND}"
      ;;
    v)
      VERBOSE=1
      ;;
    s)
    	STAGE="${OPTARG}"
    	;;
    d)
			DATABASE_DUMP_FILE="${OPTARG}"
			;;
	  u)
	  	UNCOMPRESS_DUMP=1
	  	;;
    *)
      die "Invalid option: -$OPTARG"
      ;;
  esac
done

case "$COMMAND" in
  setup)
    setup
    ;;
  assertSetup)
    assertSetup
    ;;
  update)
  	updateDevTools "${SCRIPT_DIR}"
		;;
	databaseCreate)
		databaseCreate
		;;
	databaseDrop)
		databaseDrop
		;;
	databaseImport)
		databaseImport "${DATABASE_DUMP_FILE}"
		;;
	tailLogs)
		tailCloudWatchLogs
		;;
	cleanDbDir)
		cleanDbDirectory
		;;
esac
