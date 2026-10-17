-- Database-level access for one environment. Contains no passwords.
-- Run as an administrator after 01_database_and_logins.sql (or after creating the two
-- logins by other means). Safe to re-run; it also removes broader access granted earlier.
--
-- Variables: DB_NAME, MIGRATOR_LOGIN, APP_LOGIN
--
-- Privilege model:
--   MIGRATOR_LOGIN  deployment identity. db_owner of this database only (no server roles),
--                   used solely to apply migrations.
--   APP_LOGIN       runtime identity. Member of the app_runtime role only. Object
--                   permissions are granted to app_runtime by the migrations that create
--                   those objects, so they are versioned with the schema.

USE [$(DB_NAME)];
GO

-- Deployment identity
IF DATABASE_PRINCIPAL_ID(N'$(MIGRATOR_LOGIN)') IS NULL
    CREATE USER [$(MIGRATOR_LOGIN)] FOR LOGIN [$(MIGRATOR_LOGIN)];
IF IS_ROLEMEMBER(N'db_owner', N'$(MIGRATOR_LOGIN)') = 0
    ALTER ROLE db_owner ADD MEMBER [$(MIGRATOR_LOGIN)];
GO

-- Runtime identity
IF DATABASE_PRINCIPAL_ID(N'app_runtime') IS NULL
    CREATE ROLE app_runtime;
IF DATABASE_PRINCIPAL_ID(N'$(APP_LOGIN)') IS NULL
    CREATE USER [$(APP_LOGIN)] FOR LOGIN [$(APP_LOGIN)];
IF IS_ROLEMEMBER(N'app_runtime', N'$(APP_LOGIN)') = 0
    ALTER ROLE app_runtime ADD MEMBER [$(APP_LOGIN)];
GO

-- Least privilege: remove the runtime identity from every other role
-- (Phase 1 originally made the application login db_owner).
DECLARE @role sysname, @statement nvarchar(max);
DECLARE extra_roles CURSOR LOCAL FAST_FORWARD FOR
    SELECT r.name
    FROM sys.database_role_members AS m
    JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
    JOIN sys.database_principals AS u ON u.principal_id = m.member_principal_id
    WHERE u.name = N'$(APP_LOGIN)' AND r.name <> N'app_runtime';
OPEN extra_roles;
FETCH NEXT FROM extra_roles INTO @role;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @statement = N'ALTER ROLE ' + QUOTENAME(@role) + N' DROP MEMBER ' + QUOTENAME(N'$(APP_LOGIN)');
    EXEC (@statement);
    FETCH NEXT FROM extra_roles INTO @role;
END;
CLOSE extra_roles;
DEALLOCATE extra_roles;
GO
