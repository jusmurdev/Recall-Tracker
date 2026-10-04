-- Barcodes are compared as GTIN-14 (zero-padded) so UPC-A and EAN-13 forms of the same code match.
UPDATE "Recall" SET upcs = ARRAY(SELECT lpad(u, 14, '0') FROM unnest(upcs) AS u) WHERE cardinality(upcs) > 0;
UPDATE "WatchItem" SET upc = lpad(upc, 14, '0') WHERE upc IS NOT NULL AND length(upc) BETWEEN 8 AND 13;
