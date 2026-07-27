select table_name, column_name, data_type, column_default
from information_schema.columns
where (table_name = 'profiles' and column_name in ('use_24_hour_time', 'shoulder_surfer_mode'))
   or (table_name = 'organizations' and column_name in ('timecard_rounding_minutes', 'default_cc_email'))
order by table_name, column_name;
