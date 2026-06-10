-- AddColumn: createdAt / updatedAt on item_categories
ALTER TABLE "item_categories"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey: bom_lines.componentItemId → items.id
ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_componentItemId_fkey"
  FOREIGN KEY ("componentItemId") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: lots.itemId → items.id
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: inventory_balances.binId → bins.id (nullable)
ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_binId_fkey"
  FOREIGN KEY ("binId") REFERENCES "bins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: inventory_balances.lotId → lots.id (nullable)
ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "lots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: stock_movements.binId → bins.id (nullable)
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_binId_fkey"
  FOREIGN KEY ("binId") REFERENCES "bins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: stock_movements.lotId → lots.id (nullable)
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "lots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
