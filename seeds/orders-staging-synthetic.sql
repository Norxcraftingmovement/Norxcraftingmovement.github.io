-- SYNTHETIC DATA ONLY. Apply to norx-orders-staging; never to production.
INSERT INTO meta(key,value) VALUES ('environment','staging'),('schema','1');
INSERT INTO counters(name,value) VALUES ('order_no',0);
INSERT INTO collections(id,slug,name,status) VALUES (1,'test-collection','TEST Collection','active');
INSERT INTO products(id,collection_id,slug,name,short_name,fit,status,legacy_id) VALUES (1,1,'test-tee','TEST Tee','Test','boxy','active','test01');
INSERT INTO product_variants(product_id,sleeve,price_baht) VALUES (1,'short',500),(1,'long',600);
INSERT INTO product_sizes(product_id,size,sort) VALUES (1,'S',1),(1,'M',2),(1,'L',3);
INSERT INTO rounds(id,name,kind,shipping_baht,deliveries,status) VALUES (1,'TEST Round','fixed',50,'["city","ship"]','open');
INSERT INTO round_products(round_id,product_id) VALUES (1,1);
INSERT INTO customers(id,name,phone) VALUES (1,'TEST Customer','0000000000');
INSERT INTO orders(id,order_no,round_id,customer_id,source,delivery,subtotal_baht,shipping_baht,total_baht,is_test)
  VALUES (1,'TEST-0001',1,1,'manual','ship',1000,50,1050,1);
INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht) VALUES (1,1,'short','M',2,500,1000);
INSERT INTO shipping_addresses(order_id,recipient,phone,address,postal_code) VALUES (1,'TEST Customer','0000000000','1 Test Road, Test City','00000');
