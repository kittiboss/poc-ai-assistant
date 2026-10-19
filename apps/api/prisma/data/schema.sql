-- Table schema for products.csv (works on PostgreSQL and MySQL 8+)
CREATE TABLE products (
    product_id      INT            PRIMARY KEY,
    sku             VARCHAR(20)    NOT NULL UNIQUE,
    name            VARCHAR(150)   NOT NULL,
    description     TEXT           NOT NULL,
    category        VARCHAR(50)    NOT NULL,
    subcategory     VARCHAR(50)    NOT NULL,
    brand           VARCHAR(50)    NOT NULL,
    price           DECIMAL(10,2)  NOT NULL,
    cost_price      DECIMAL(10,2)  NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'USD',
    stock_quantity  INT            NOT NULL DEFAULT 0,
    weight_kg       DECIMAL(8,2),
    color           VARCHAR(50),
    material        VARCHAR(100),
    rating          DECIMAL(2,1),
    review_count    INT            NOT NULL DEFAULT 0,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP      NOT NULL,
    updated_at      TIMESTAMP      NOT NULL
);

-- ---------- PostgreSQL ----------
-- psql:
-- \copy products FROM 'products.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- ---------- MySQL ----------
-- Note: MySQL needs 'true'/'false' converted to 1/0 for BOOLEAN, handled below.
-- LOAD DATA LOCAL INFILE 'products.csv'
-- INTO TABLE products
-- CHARACTER SET utf8mb4
-- FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
-- LINES TERMINATED BY '\n'
-- IGNORE 1 LINES
-- (product_id, sku, name, description, category, subcategory, brand, price, cost_price,
--  currency, stock_quantity, weight_kg, color, material, rating, review_count, @is_active,
--  created_at, updated_at)
-- SET is_active = (@is_active = 'true');
