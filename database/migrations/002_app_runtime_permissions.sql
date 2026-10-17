-- Runtime permissions. The application identity is a member of app_runtime only, and
-- app_runtime gets exactly what the application needs: read the greeting.
-- Any later migration that adds objects the application uses grants the minimum here too.

IF DATABASE_PRINCIPAL_ID(N'app_runtime') IS NULL
    CREATE ROLE app_runtime;
GO

GRANT SELECT ON dbo.Greeting TO app_runtime;
GO
