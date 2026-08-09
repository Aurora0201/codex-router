import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

describe("Select", () => {
  it("uses a border affordance and lets highlight style the selected item", async () => {
    const user = userEvent.setup()

    render(
      <Select defaultValue="system" items={{ system: "跟随系统", light: "浅色" }}>
        <SelectTrigger aria-label="主题">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="system">跟随系统</SelectItem>
          <SelectItem value="light">浅色</SelectItem>
        </SelectContent>
      </Select>
    )

    const trigger = screen.getByRole("combobox", { name: "主题" })
    expect(trigger).toHaveClass("hover:border-border", "data-popup-open:border-border")

    await user.click(trigger)

    const selectedItem = screen.getByRole("option", { name: "跟随系统" })
    expect(selectedItem).toHaveAttribute("data-selected")
    expect(selectedItem).toHaveAttribute("data-highlighted")
    expect(selectedItem).toHaveClass("data-highlighted:bg-accent")
    expect(selectedItem).not.toHaveClass("focus:bg-accent")

    await user.keyboard("{ArrowDown}")

    expect(selectedItem).not.toHaveAttribute("data-highlighted")
    expect(screen.getByRole("option", { name: "浅色" })).toHaveAttribute("data-highlighted")
  })
})
