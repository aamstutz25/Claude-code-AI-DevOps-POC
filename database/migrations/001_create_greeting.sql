-- Creates the Greeting table and seeds the Hello World message.

CREATE TABLE dbo.Greeting (
    GreetingId INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Greeting PRIMARY KEY,
    Message NVARCHAR(200) NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Greeting_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO

INSERT INTO dbo.Greeting (Message) VALUES (N'Hello, World!');
GO
