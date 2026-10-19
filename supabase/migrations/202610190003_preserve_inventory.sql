begin;

insert into public.vehicles (id, legacy_id, brand, model, year, price, mileage_label, fuel, transmission, body_type, collection, horsepower, engine, published)
values
('a0000000-0000-4000-8000-000000000001','bmw-m4','BMW','M4 Competition',2021,95000,'Delivery mileage','Petrol','8-speed M Steptronic','Coupe','Performance','503 HP','3.0L Twin Turbo',true),
('a0000000-0000-4000-8000-000000000002','mercedes-c-w206','Mercedes-Benz','C-Class W206',2022,59000,'Delivery mileage','Petrol / Hybrid','Automatic','Sedan','Luxury','Specification on request','Specification on request',true),
('a0000000-0000-4000-8000-000000000003','porsche-911','Porsche','911 Carrera',2025,128000,'Delivery mileage','Petrol','8-speed PDK','Coupe','Performance','388 HP','3.0L Twin Turbo Flat-6',true),
('a0000000-0000-4000-8000-000000000004','range-rover-sport','Land Rover','Range Rover Sport',2025,108000,'Delivery mileage','Hybrid','Automatic','SUV','SUV','395 HP','3.0L Mild Hybrid',true),
('a0000000-0000-4000-8000-000000000005','g-class','Mercedes-Benz','G 550',2025,148000,'Delivery mileage','Petrol','9-speed Automatic','SUV','Luxury','443 HP','3.0L Turbo Inline-6',true),
('a0000000-0000-4000-8000-000000000006','lamborghini-revuelto','Lamborghini','Revuelto',2024,608000,'Delivery mileage','Plug-in Hybrid','8-speed Dual-Clutch','Coupe','Performance','1,001 HP','6.5L V12 Hybrid',true)
on conflict do nothing;

insert into public.vehicle_images (id, vehicle_id, legacy_path, label, credit, sort_order, is_cover, pending)
select ('b0000000-0000-4000-8000-' || lpad(position::text,12,'0'))::uuid, vehicle.id,
  image->>'src', image->>'label', coalesce(image->>'credit',''), position - 1, position = 1, coalesce((image->>'pending')::boolean,false)
from public.vehicles as vehicle cross join jsonb_array_elements('[
  {"label":"Inside BMW Welt","src":"assets/photos/bmw-m4-welt.jpg","credit":"BMW M4 at BMW Welt \u00b7 Strubbl \u00b7 CC0"},
  {"label":"Front","src":"assets/photos/m4-g82-front.jpg","credit":"BMW M4 Competition G82, front \u00b7 LuvsMG481 \u00b7 CC BY-SA 4.0"},
  {"label":"Rear","src":"assets/photos/m4-g82-rear.jpg","credit":"BMW M4 Competition G82, rear \u00b7 LuvsMG481 \u00b7 CC BY-SA 4.0"},
  {"label":"Exterior detail","src":"assets/photos/m4-g82-front-road.jpg","credit":"2021 BMW M4 Competition \u00b7 Calreyn88 \u00b7 CC BY-SA 4.0"},
  {"label":"Rear detail","src":"assets/photos/m4-g82-rear-road.jpg","credit":"2021 BMW M4 Competition \u00b7 Calreyn88 \u00b7 CC BY-SA 4.0"},
  {"label":"Side","pending":true},{"label":"Wheels","pending":true},{"label":"Dashboard","pending":true}
]'::jsonb) with ordinality as photos(image, position)
where vehicle.legacy_id = 'bmw-m4'
on conflict do nothing;

insert into public.site_content (section, data, published) values
('about','{"paragraph1":"AUTO HAUS GROUP is an independent automotive house built around thoughtful service, enduring design, and the pleasure of finding the right car.","paragraph2":"A considered collection, a personal welcome, and room to make up your own mind.","values":[{"title":"Curated","description":"Distinctive vehicles, thoughtfully selected."},{"title":"Personal","description":"Care and attention, at every step."},{"title":"Lebanon","description":"A local welcome. An international outlook."}]}',true),
('services','{"items":[{"title":"Vehicle sales","description":"A considered collection and personal guidance to find your next car."},{"title":"Trade-in","description":"A thoughtful next step for the car you own and the one you want."},{"title":"Financing","description":"Discuss purchase options that suit your plans and priorities."},{"title":"Vehicle inspection","description":"A closer look at the details that matter before you decide."},{"title":"Maintenance","description":"Care and attention to keep every journey feeling right."},{"title":"After-sales","description":"A familiar point of contact throughout your ownership."}]}',true),
('contact','{"email":"hello@example.com","phone":"","whatsapp":"","address":"Lebanon","hours":"Mon\u2013Sat \u00b7 09:00\u201319:00"}',true),
('copy','{"inventory_title":"Available vehicles.","inventory_intro":"Distinctive cars. Thoughtfully selected.","brands_title":"Marques with character.","brands_intro":"Different expressions of the same passion for the drive.","services_title":"Every detail. Considered.","services_intro":"Personal support before, during, and after the drive.","about_title":"A house built around the drive.","about_intro":"Independent by nature. Personal by design. Based in Lebanon.","contact_title":"Let\u2019s talk.","contact_intro":"Your next car starts with a conversation. Our team in Lebanon is here for you."}',true)
on conflict do nothing;

commit;