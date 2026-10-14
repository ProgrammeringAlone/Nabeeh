UPDATE categories SET region='all' WHERE id='gulf';
UPDATE questions SET region=CASE
  WHEN fact_key IN('oman:capital','sabllah:identity') THEN 'om'
  WHEN fact_key='king-fahd-causeway:connection' THEN 'bh'
  ELSE 'sa' END
WHERE provenance LIKE 'Original Nabeeh development seed%' AND id IN(SELECT question_id FROM question_categories WHERE category_id='gulf');
