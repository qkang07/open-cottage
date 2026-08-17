(module
 (type $0 (func (result i32)))
 (type $1 (func (param i32 i32 i32 i32 i32)))
 (memory $0 0)
 (export "getHeapBase" (func $assembly/cosine/getHeapBase))
 (export "cosineBatch" (func $assembly/cosine/cosineBatch))
 (export "memory" (memory $0))
 (func $assembly/cosine/getHeapBase (result i32)
  i32.const 1024
 )
 (func $assembly/cosine/cosineBatch (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
  (local $5 i32)
  (local $6 v128)
  (local $7 i32)
  (local $8 f32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  local.get $3
  i32.const -4
  i32.and
  local.set $10
  local.get $3
  i32.const 2
  i32.shl
  local.set $11
  loop $for-loop|0
   local.get $2
   local.get $7
   i32.gt_s
   if
    local.get $1
    local.get $7
    local.get $11
    i32.mul
    i32.add
    local.set $9
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    local.set $6
    i32.const 0
    local.set $5
    loop $for-loop|1
     local.get $5
     local.get $10
     i32.lt_s
     if
      local.get $6
      local.get $5
      i32.const 2
      i32.shl
      local.tee $12
      local.get $0
      i32.add
      v128.load
      local.get $9
      local.get $12
      i32.add
      v128.load
      f32x4.mul
      f32x4.add
      local.set $6
      local.get $5
      i32.const 4
      i32.add
      local.set $5
      br $for-loop|1
     end
    end
    local.get $6
    f32x4.extract_lane 0
    local.get $6
    f32x4.extract_lane 1
    f32.add
    local.get $6
    f32x4.extract_lane 2
    f32.add
    local.get $6
    f32x4.extract_lane 3
    f32.add
    local.set $8
    loop $for-loop|2
     local.get $3
     local.get $5
     i32.gt_s
     if
      local.get $8
      local.get $5
      i32.const 2
      i32.shl
      local.tee $12
      local.get $0
      i32.add
      f32.load
      local.get $9
      local.get $12
      i32.add
      f32.load
      f32.mul
      f32.add
      local.set $8
      local.get $5
      i32.const 1
      i32.add
      local.set $5
      br $for-loop|2
     end
    end
    local.get $4
    local.get $7
    i32.const 2
    i32.shl
    i32.add
    local.get $8
    f32.store
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|0
   end
  end
 )
)
