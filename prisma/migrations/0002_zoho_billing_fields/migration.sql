-- AlterTable
ALTER TABLE `Estimate`
    ADD COLUMN `zohoEstimateId` VARCHAR(64) NULL,
    ADD COLUMN `referenceNumber` VARCHAR(191) NULL,
    ADD COLUMN `projectName` VARCHAR(191) NULL,
    ADD COLUMN `placeOfSupply` VARCHAR(100) NULL,
    ADD COLUMN `adjustmentLabel` VARCHAR(64) NULL,
    MODIFY COLUMN `roundOff` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX `Estimate_zohoEstimateId_key` ON `Estimate`(`zohoEstimateId`);

-- AlterTable
ALTER TABLE `EstimateItem`
    ADD COLUMN `itemName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Invoice`
    ADD COLUMN `referenceNumber` VARCHAR(191) NULL,
    ADD COLUMN `projectName` VARCHAR(191) NULL,
    ADD COLUMN `placeOfSupply` VARCHAR(100) NULL,
    ADD COLUMN `adjustmentLabel` VARCHAR(64) NULL,
    MODIFY COLUMN `roundOff` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `InvoiceItem`
    ADD COLUMN `itemName` VARCHAR(191) NULL;
