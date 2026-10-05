-- Earlier app versions watched every scan by default and could save items labelled "scan" or a
-- single generic word ("milk"). Those match nearly every recall that mentions the word, so remove
-- them once. Alerts they produced stay in the inbox (Alert.watchItemId is set to NULL).
DELETE FROM "WatchItem"
WHERE kind IN ('scan', 'product')
  AND upc IS NULL
  AND (
    lower(btrim(label)) = 'scan'
    OR lower(btrim(label)) IN (
      'milk', 'eggs', 'egg', 'bread', 'cheese', 'butter', 'cream', 'yogurt', 'chicken', 'beef', 'pork', 'turkey',
      'ham', 'bacon', 'fish', 'food', 'juice', 'water', 'soda', 'coffee', 'tea', 'rice', 'pasta', 'cereal',
      'fruit', 'salad', 'lettuce', 'spinach', 'banana', 'bananas', 'apple', 'apples', 'chips', 'snack', 'snacks',
      'candy', 'chocolate', 'sugar', 'flour', 'salt', 'oil', 'sauce', 'soup', 'meat', 'deli', 'frozen', 'organic',
      'dog food', 'cat food', 'whole milk', 'scanned product'
    )
  );
