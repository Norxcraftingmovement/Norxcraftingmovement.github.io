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
-- Synthetic shipping orders (all TEST, fake names/addresses) incl. long Thai addresses for label layout checks.
INSERT INTO customers(id,name,phone) VALUES (2,'ทดสอบ นามสมมติ',  '0800000001'),(3,'ทดสอบ ชื่อยาวมากสำหรับตรวจการตัดบรรทัด สมมติ นามสกุลยาวเช่นกัน','0800000002'),(4,'TEST Pickup','0800000003');
INSERT INTO orders(id,order_no,round_id,customer_id,source,delivery,subtotal_baht,shipping_baht,total_baht,payment_status,fulfillment_status,is_test)
  VALUES (2,'TEST-0002',1,2,'manual','ship',500,50,550,'confirmed','ready_ship',1),
         (3,'TEST-0003',1,3,'manual','ship',1200,50,1250,'confirmed','ready_ship',1),
         (4,'TEST-0004',1,4,'manual','city',500,0,500,'pending','received',1);
INSERT INTO orders(id,order_no,round_id,customer_id,source,delivery,subtotal_baht,shipping_baht,total_baht,payment_timing,is_test)
  VALUES (5,'TEST-0005',1,4,'manual','event',500,0,500,'on_site',1);
INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht) VALUES (2,1,'short','S',1,500,500),(3,1,'long','L',2,600,1200),(4,1,'short','M',1,500,500),(5,1,'short','M',1,500,500);
INSERT INTO shipping_addresses(order_id,recipient,phone,address,postal_code) VALUES
 (2,'ทดสอบ นามสมมติ','0800000001','99/9 หมู่ 9 ถนนทดสอบ ตำบลทดสอบ อำเภอเมืองสมมติ จังหวัดเชียงราย 57000','57000'),
 (3,'ทดสอบ ชื่อยาวมากสำหรับตรวจการตัดบรรทัด สมมติ นามสกุลยาวเช่นกัน','0800000002','เลขที่ 123/45 อาคารสมมติเรสซิเดนซ์ ชั้น 12 ห้อง 1208 หมู่บ้านทดสอบวิลล์ ซอยทดสอบ 7 แยก 3 (ตรงข้ามร้านสมมติ ติดกับโรงเรียนทดสอบวิทยา) ถนนสมมติเหนือ แขวงทดสอบใต้ เขตสมมติ กรุงเทพมหานคร 10110 โทรก่อนส่งทุกครั้ง ฝากไว้กับ รปภ. ได้','10110');
