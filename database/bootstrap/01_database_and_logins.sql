-- Server-level setup for one environment: the application database and its two SQL logins.
-- Run once per environment as an administrator. Safe to re-run: existing objects are kept
-- and existing passwords are NOT changed.
--
-- Variables (sqlcmd-style; supplied as environment variables or with sqlcmd -v):
--   DB_NAME            application database, e.g. HelloPoc
--   MIGRATOR_LOGIN     migration/deployment identity, e.g. poc_migrator
--   MIGRATOR_PASSWORD
--   APP_LOGIN          application runtime identity, e.g. poc_app
--   APP_PASSWORD
--
-- CI runs it with: node backend/scripts/run-sql.js database/bootstrap/01_database_and_logins.sql
-- See database/README.md for running it locally.

IF DB_ID(N'$(DB_NAME)') IS NULL
    CREATE DATABASE [$(DB_NAME)];
GO

IF SUSER_ID(N'$(MIGRATOR_LOGIN)') IS NULL
    CREATE LOGIN [$(MIGRATOR_LOGIN)]
        WITH PASSWORD = N'$(MIGRATOR_PASSWORD)', DEFAULT_DATABASE = [$(DB_NAME)];
GO

IF SUSER_ID(N'$(APP_LOGIN)') IS NULL
    CREATE LOGIN [$(APP_LOGIN)]
        WITH PASSWORD = N'$(APP_PASSWORD)', DEFAULT_DATABASE = [$(DB_NAME)];
GO
