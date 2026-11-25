-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `totpSecretEncrypted` TEXT NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `resetTokenHash` VARCHAR(255) NULL,
    `resetTokenExpiresAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(255) NOT NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `company` VARCHAR(191) NULL,
    `contactPerson` VARCHAR(191) NULL,
    `emails` JSON NOT NULL,
    `whatsappPhone` VARCHAR(32) NULL,
    `secondaryPhones` JSON NULL,
    `address` TEXT NULL,
    `state` VARCHAR(100) NULL,
    `gstin` VARCHAR(32) NULL,
    `notes` TEXT NULL,
    `preferredChannel` ENUM('EMAIL', 'WHATSAPP', 'BOTH') NOT NULL DEFAULT 'BOTH',
    `remindersEnabled` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `tags` JSON NULL,
    `publicStatusToken` VARCHAR(128) NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Client_publicStatusToken_key`(`publicStatusToken`),
    INDEX `Client_status_idx`(`status`),
    INDEX `Client_whatsappPhone_idx`(`whatsappPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderAccount` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `providerKey` ENUM('HOSTINGER', 'GODADDY', 'REDIFF', 'SPACESHIP', 'CLOUDFLARE', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `type` ENUM('REGISTRAR', 'HOST', 'BOTH') NOT NULL DEFAULT 'BOTH',
    `loginEmail` VARCHAR(191) NULL,
    `accountUrl` VARCHAR(512) NULL,
    `notes` TEXT NULL,
    `apiCredentialsEncrypted` TEXT NULL,
    `apiSyncEnabled` BOOLEAN NOT NULL DEFAULT false,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProviderAccount_providerKey_idx`(`providerKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Domain` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `providerAccountId` VARCHAR(191) NULL,
    `registeredOn` DATETIME(3) NULL,
    `expiryDate` DATETIME(3) NOT NULL,
    `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    `nameservers` JSON NULL,
    `dnsProvider` VARCHAR(191) NULL,
    `whoisPrivacy` BOOLEAN NOT NULL DEFAULT true,
    `costPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `renewalYears` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('ACTIVE', 'EXPIRING', 'EXPIRED', 'REDEMPTION', 'TRANSFERRED') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `lastRdapVerifiedAt` DATETIME(3) NULL,
    `rdapExpiryDate` DATETIME(3) NULL,
    `rdapMismatch` BOOLEAN NOT NULL DEFAULT false,
    `rdapUnsupported` BOOLEAN NOT NULL DEFAULT false,
    `whoPays` ENUM('CLIENT', 'ME') NOT NULL DEFAULT 'CLIENT',
    `dnsSnapshot` JSON NULL,
    `sslExpiryDate` DATETIME(3) NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Domain_name_key`(`name`),
    INDEX `Domain_clientId_idx`(`clientId`),
    INDEX `Domain_providerAccountId_idx`(`providerAccountId`),
    INDEX `Domain_expiryDate_idx`(`expiryDate`),
    INDEX `Domain_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('HOSTING', 'EMAIL_HOSTING', 'SSL', 'MAINTENANCE_AMC', 'CDN', 'OTHER') NOT NULL DEFAULT 'HOSTING',
    `providerAccountId` VARCHAR(191) NULL,
    `planName` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NULL,
    `renewalDate` DATETIME(3) NOT NULL,
    `billingCycle` ENUM('MONTHLY', 'QUARTERLY', 'YEARLY', 'MULTI_YEAR') NOT NULL DEFAULT 'YEARLY',
    `costPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Service_clientId_idx`(`clientId`),
    INDEX `Service_providerAccountId_idx`(`providerAccountId`),
    INDEX `Service_renewalDate_idx`(`renewalDate`),
    INDEX `Service_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceDomain` (
    `serviceId` VARCHAR(191) NOT NULL,
    `domainId` VARCHAR(191) NOT NULL,

    INDEX `ServiceDomain_domainId_idx`(`domainId`),
    PRIMARY KEY (`serviceId`, `domainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Website` (
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `label` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `domainId` VARCHAR(191) NULL,
    `intervalMinutes` INTEGER NOT NULL DEFAULT 5,
    `expectedStatusCode` INTEGER NOT NULL DEFAULT 200,
    `requiredKeyword` VARCHAR(255) NULL,
    `timeoutMs` INTEGER NOT NULL DEFAULT 10000,
    `failureThreshold` INTEGER NOT NULL DEFAULT 2,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `isDown` BOOLEAN NOT NULL DEFAULT false,
    `alertContacts` JSON NULL,
    `notifyClient` BOOLEAN NOT NULL DEFAULT false,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `sslExpiry` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastResponseMs` INTEGER NULL,
    `publicStatusToken` VARCHAR(128) NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Website_publicStatusToken_key`(`publicStatusToken`),
    INDEX `Website_clientId_idx`(`clientId`),
    INDEX `Website_domainId_idx`(`domainId`),
    INDEX `Website_paused_idx`(`paused`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UptimeCheck` (
    `id` VARCHAR(191) NOT NULL,
    `websiteId` VARCHAR(191) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `up` BOOLEAN NOT NULL,
    `httpCode` INTEGER NULL,
    `responseMs` INTEGER NULL,
    `error` VARCHAR(512) NULL,

    INDEX `UptimeCheck_websiteId_checkedAt_idx`(`websiteId`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Incident` (
    `id` VARCHAR(191) NOT NULL,
    `websiteId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `durationSeconds` INTEGER NULL,
    `notifiedOwner` BOOLEAN NOT NULL DEFAULT false,
    `notifiedClient` BOOLEAN NOT NULL DEFAULT false,
    `errorSummary` VARCHAR(512) NULL,

    INDEX `Incident_websiteId_startedAt_idx`(`websiteId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CatalogItem` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `hsnSac` VARCHAR(32) NULL,
    `defaultRate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxPercent` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Estimate` (
    `id` VARCHAR(191) NOT NULL,
    `estimateNumber` VARCHAR(64) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `gstMode` ENUM('CGST_SGST', 'IGST', 'NONE') NOT NULL DEFAULT 'CGST_SGST',
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `roundOff` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `terms` TEXT NULL,
    `status` ENUM('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'DRAFT',
    `publicToken` VARCHAR(128) NOT NULL,
    `clientComment` TEXT NULL,
    `convertedInvoiceId` VARCHAR(64) NULL,
    `viewedAt` DATETIME(3) NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Estimate_estimateNumber_key`(`estimateNumber`),
    UNIQUE INDEX `Estimate_publicToken_key`(`publicToken`),
    INDEX `Estimate_clientId_idx`(`clientId`),
    INDEX `Estimate_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EstimateItem` (
    `id` VARCHAR(191) NOT NULL,
    `estimateId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(512) NOT NULL,
    `hsnSac` VARCHAR(32) NULL,
    `qty` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `rate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxPercent` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `lineTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `EstimateItem_estimateId_idx`(`estimateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(64) NOT NULL,
    `financialYear` VARCHAR(16) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `gstMode` ENUM('CGST_SGST', 'IGST', 'NONE') NOT NULL DEFAULT 'CGST_SGST',
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `cgstTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sgstTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `igstTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `roundOff` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amountPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `terms` TEXT NULL,
    `publicToken` VARCHAR(128) NOT NULL,
    `viewedAt` DATETIME(3) NULL,
    `recurring` BOOLEAN NOT NULL DEFAULT false,
    `recurringCycle` ENUM('MONTHLY', 'QUARTERLY', 'YEARLY', 'MULTI_YEAR') NULL,
    `nextRecurringAt` DATETIME(3) NULL,
    `razorpayOrderId` VARCHAR(128) NULL,
    `razorpayLinkUrl` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `Invoice_publicToken_key`(`publicToken`),
    INDEX `Invoice_clientId_idx`(`clientId`),
    INDEX `Invoice_status_idx`(`status`),
    INDEX `Invoice_dueDate_idx`(`dueDate`),
    INDEX `Invoice_financialYear_idx`(`financialYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceItem` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(512) NOT NULL,
    `hsnSac` VARCHAR(32) NULL,
    `qty` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `rate` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxPercent` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `lineTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `domainId` VARCHAR(191) NULL,
    `serviceId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `InvoiceItem_invoiceId_idx`(`invoiceId`),
    INDEX `InvoiceItem_domainId_idx`(`domainId`),
    INDEX `InvoiceItem_serviceId_idx`(`serviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `receiptNumber` VARCHAR(64) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('UPI', 'BANK', 'CASH', 'RAZORPAY', 'OTHER') NOT NULL DEFAULT 'UPI',
    `referenceUtr` VARCHAR(128) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_receiptNumber_key`(`receiptNumber`),
    INDEX `Payment_invoiceId_idx`(`invoiceId`),
    INDEX `Payment_clientId_idx`(`clientId`),
    INDEX `Payment_paidAt_idx`(`paidAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreditNote` (
    `id` VARCHAR(191) NOT NULL,
    `creditNoteNumber` VARCHAR(64) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CreditNote_creditNoteNumber_key`(`creditNoteNumber`),
    INDEX `CreditNote_invoiceId_idx`(`invoiceId`),
    INDEX `CreditNote_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `clientId` VARCHAR(191) NULL,
    `domainId` VARCHAR(191) NULL,
    `serviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Expense_date_idx`(`date`),
    INDEX `Expense_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReminderRule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `itemType` ENUM('DOMAIN', 'SERVICE', 'INVOICE', 'ESTIMATE', 'UPTIME') NOT NULL,
    `offsets` JSON NOT NULL,
    `channels` JSON NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReminderRule_itemType_enabled_idx`(`itemType`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'en',
    `channel` ENUM('EMAIL', 'WHATSAPP') NOT NULL,
    `subject` VARCHAR(255) NULL,
    `body` TEXT NOT NULL,
    `waTemplateName` VARCHAR(191) NULL,
    `waLanguageCode` VARCHAR(16) NULL,
    `waVariableMapping` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MessageTemplate_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageLog` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `channel` ENUM('EMAIL', 'WHATSAPP') NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `renderedSubject` VARCHAR(255) NULL,
    `renderedContent` TEXT NOT NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `offsetDays` INTEGER NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `providerMessageId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `direction` VARCHAR(16) NOT NULL DEFAULT 'OUTBOUND',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MessageLog_idempotencyKey_key`(`idempotencyKey`),
    INDEX `MessageLog_clientId_idx`(`clientId`),
    INDEX `MessageLog_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `MessageLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `businessName` VARCHAR(191) NOT NULL DEFAULT 'Aligarh Web Solutions',
    `businessState` VARCHAR(100) NOT NULL DEFAULT 'Uttar Pradesh',
    `address` TEXT NULL,
    `gstin` VARCHAR(32) NULL,
    `pan` VARCHAR(32) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAccountNumber` VARCHAR(64) NULL,
    `bankIfsc` VARCHAR(32) NULL,
    `bankAccountName` VARCHAR(191) NULL,
    `upiId` VARCHAR(128) NULL,
    `logoDataUrl` MEDIUMTEXT NULL,
    `invoicePrefix` VARCHAR(32) NOT NULL DEFAULT 'INV',
    `estimatePrefix` VARCHAR(32) NOT NULL DEFAULT 'EST',
    `receiptPrefix` VARCHAR(32) NOT NULL DEFAULT 'RCPT',
    `defaultTaxRate` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `gstEnabled` BOOLEAN NOT NULL DEFAULT true,
    `defaultInvoiceTerms` TEXT NULL,
    `defaultEstimateTerms` TEXT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'INR',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `smtpHost` VARCHAR(191) NOT NULL DEFAULT 'smtp.hostinger.com',
    `smtpPort` INTEGER NOT NULL DEFAULT 465,
    `smtpSecure` BOOLEAN NOT NULL DEFAULT true,
    `smtpUser` VARCHAR(191) NULL,
    `smtpPassEncrypted` TEXT NULL,
    `smtpFromName` VARCHAR(191) NOT NULL DEFAULT 'Aligarh Web Solutions',
    `smtpFromEmail` VARCHAR(191) NULL,
    `emailProvider` VARCHAR(32) NOT NULL DEFAULT 'SMTP',
    `emailApiKeyEncrypted` TEXT NULL,
    `whatsappPhoneNumberId` VARCHAR(128) NULL,
    `whatsappBusinessAccountId` VARCHAR(128) NULL,
    `whatsappAccessTokenEnc` TEXT NULL,
    `whatsappVerifyTokenEnc` TEXT NULL,
    `whatsappAppSecretEnc` TEXT NULL,
    `ownerAlertEmail` VARCHAR(191) NULL,
    `ownerAlertWhatsapp` VARCHAR(32) NULL,
    `quietHoursStart` VARCHAR(8) NOT NULL DEFAULT '20:00',
    `quietHoursEnd` VARCHAR(8) NOT NULL DEFAULT '09:00',
    `reminderEvalHourIst` INTEGER NOT NULL DEFAULT 6,
    `dryRunMode` BOOLEAN NOT NULL DEFAULT false,
    `recurringAutoSend` BOOLEAN NOT NULL DEFAULT false,
    `razorpayEnabled` BOOLEAN NOT NULL DEFAULT false,
    `razorpayKeyId` VARCHAR(128) NULL,
    `razorpayKeySecretEnc` TEXT NULL,
    `razorpayWebhookSecretEnc` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobState` (
    `jobName` VARCHAR(64) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(32) NULL,
    `lastSummary` TEXT NULL,
    `lockedUntil` DATETIME(3) NULL,
    `lockedBy` VARCHAR(128) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`jobName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorEmail` VARCHAR(191) NULL,
    `action` VARCHAR(128) NOT NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `summary` VARCHAR(512) NOT NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `domainId` VARCHAR(191) NULL,
    `filename` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(128) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `notes` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attachment_clientId_idx`(`clientId`),
    INDEX `Attachment_domainId_idx`(`domainId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `dueDate` DATETIME(3) NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `priority` VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    `clientId` VARCHAR(191) NULL,
    `domainId` VARCHAR(191) NULL,
    `serviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_status_dueDate_idx`(`status`, `dueDate`),
    INDEX `Task_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Domain` ADD CONSTRAINT `Domain_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Domain` ADD CONSTRAINT `Domain_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `ProviderAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `ProviderAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceDomain` ADD CONSTRAINT `ServiceDomain_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceDomain` ADD CONSTRAINT `ServiceDomain_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Website` ADD CONSTRAINT `Website_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Website` ADD CONSTRAINT `Website_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UptimeCheck` ADD CONSTRAINT `UptimeCheck_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Website`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Website`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Estimate` ADD CONSTRAINT `Estimate_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EstimateItem` ADD CONSTRAINT `EstimateItem_estimateId_fkey` FOREIGN KEY (`estimateId`) REFERENCES `Estimate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditNote` ADD CONSTRAINT `CreditNote_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditNote` ADD CONSTRAINT `CreditNote_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReminderRule` ADD CONSTRAINT `ReminderRule_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `MessageTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageLog` ADD CONSTRAINT `MessageLog_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageLog` ADD CONSTRAINT `MessageLog_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `MessageTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

