import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_GROUPS, findDevice } from "../assets/devices.js";

// 손으로 관리하는 표라 오타(0, 음수, 라벨 중복)를 여기서 잡는다.
test("기종 목록은 양수 정수 해상도와 고유한 라벨을 가진다", () => {
  const labels = new Set();
  let count = 0;
  for (const group of DEVICE_GROUPS) {
    assert.ok(group.label?.trim(), "그룹 이름이 비어 있다");
    assert.ok(group.devices.length, `${group.label}: 기종이 없다`);
    for (const device of group.devices) {
      assert.ok(device.label?.trim(), `${group.label}: 라벨이 비어 있다`);
      assert.equal(labels.has(device.label), false, `라벨 중복: ${device.label}`);
      labels.add(device.label);
      for (const side of ["width", "height"]) {
        assert.ok(
          Number.isInteger(device[side]) && device[side] >= 120 && device[side] <= 8000,
          `${device.label}: ${side}가 120–8000 정수가 아니다 (${device[side]})`,
        );
      }
      count++;
    }
  }
  assert.ok(count >= 10, `기종이 너무 적다 (${count})`);
});

test("findDevice는 라벨로 기종을 찾고 없으면 null", () => {
  const first = DEVICE_GROUPS[0].devices[0];
  assert.deepEqual(findDevice(first.label), first);
  assert.equal(findDevice("없는 기종"), null);
});
