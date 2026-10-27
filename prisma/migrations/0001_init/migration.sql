-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('credit', 'debit');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
    -- Last line of defence: even a buggy or concurrent debit can never overdraw an account.
    CONSTRAINT "accounts_balance_non_negative" CHECK ("balance" >= 0)
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "reference_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_seq_key" ON "transactions"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_reference_id_key" ON "transactions"("account_id", "reference_id");

-- CreateIndex
CREATE INDEX "transactions_account_id_created_at_seq_idx" ON "transactions"("account_id", "created_at" DESC, "seq" DESC);

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Transactions are immutable: reject any UPDATE or DELETE, whoever issues it.
CREATE FUNCTION "reject_transaction_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'transactions are immutable: % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transactions_immutable"
    BEFORE UPDATE OR DELETE ON "transactions"
    FOR EACH ROW EXECUTE FUNCTION "reject_transaction_change"();
